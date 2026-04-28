import type {
  ToolDefinition,
  ToolExecutionMetadata,
  ToolExecutionResult,
} from './ToolRuntime.js'
import { computerUseRuntime, type ComputerUseRuntime } from './ComputerUseRuntime.js'

export type ChatToolExecutionContext = {
  sessionId: string
  signal: AbortSignal
}

type ChatToolHandler = {
  definition: ToolDefinition
  execute(input: unknown, context: ChatToolExecutionContext): Promise<ToolExecutionResult>
}

const DEFAULT_MAX_SEARCH_RESULTS = 5
const MAX_FETCH_CHARS = 12_000

export class ChatToolRuntime {
  private tools: ChatToolHandler[]
  private computerUse: ComputerUseRuntime

  constructor(computerUse: ComputerUseRuntime = computerUseRuntime) {
    this.computerUse = computerUse
    this.tools = [
      this.createCurrentTimeTool(),
      this.createCalculatorTool(),
      this.createWeatherTool(),
      this.createWebSearchTool(),
      this.createWebFetchTool(),
    ]
  }

  getDefinitions(): ToolDefinition[] {
    return [
      ...this.tools.map((tool) => tool.definition),
      ...this.computerUse.getDefinitions(),
    ]
  }

  getRisk(toolName: string): ToolDefinition['risk'] | null {
    return this.tools.find((tool) => tool.definition.name === toolName)?.definition.risk
      ?? this.computerUse.getRisk(toolName)
  }

  async execute(
    toolName: string,
    input: unknown,
    context: ChatToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.find((entry) => entry.definition.name === toolName)
    if (!tool) {
      if (this.computerUse.hasTool(toolName)) {
        const startedAt = Date.now()
        try {
          return withDuration(
            await this.computerUse.execute(toolName, input, context),
            startedAt,
          )
        } catch (err) {
          return {
            content: err instanceof Error ? err.message : String(err),
            isError: true,
            metadata: {
              summary: 'Computer Use failed',
              durationMs: Date.now() - startedAt,
            },
          }
        }
      }
      return { content: `Unknown tool: ${toolName}`, isError: true }
    }

    const startedAt = Date.now()
    try {
      return withDuration(await tool.execute(input, context), startedAt)
    } catch (err) {
      return {
        content: err instanceof Error ? err.message : String(err),
        isError: true,
        metadata: {
          summary: 'Tool failed',
          durationMs: Date.now() - startedAt,
        },
      }
    }
  }

  async cleanupSessionTurn(sessionId: string): Promise<void> {
    await this.computerUse.cleanupSessionTurn(sessionId)
  }

  cancelSession(sessionId: string): void {
    this.computerUse.cancelSession(sessionId)
  }

  private createCurrentTimeTool(): ChatToolHandler {
    return {
      definition: {
        name: 'get_current_time',
        description: 'Get the current date and time. Use this for questions about today, now, current date, deadlines, or time zones.',
        risk: 'read',
        input_schema: {
          type: 'object',
          properties: {
            time_zone: {
              type: 'string',
              description: 'Optional IANA time zone such as "Asia/Shanghai" or "America/New_York". Defaults to the local runtime time zone.',
            },
            locale: {
              type: 'string',
              description: 'Optional locale such as "zh-CN" or "en-US".',
            },
          },
        },
      },
      execute: async (input) => {
        const obj = asObject(input)
        const now = new Date()
        const timeZone = typeof obj.time_zone === 'string' && obj.time_zone.trim()
          ? obj.time_zone.trim()
          : undefined
        const locale = typeof obj.locale === 'string' && obj.locale.trim()
          ? obj.locale.trim()
          : 'zh-CN'

        let formatted: string
        try {
          formatted = new Intl.DateTimeFormat(locale, {
            dateStyle: 'full',
            timeStyle: 'long',
            ...(timeZone ? { timeZone } : {}),
          }).format(now)
        } catch {
          formatted = now.toLocaleString()
        }

        return {
          content: [
            `ISO: ${now.toISOString()}`,
            `Local: ${formatted}`,
            timeZone ? `Time zone: ${timeZone}` : '',
          ].filter(Boolean).join('\n'),
          metadata: {
            summary: formatted,
          },
        }
      },
    }
  }

  private createCalculatorTool(): ChatToolHandler {
    return {
      definition: {
        name: 'calculate',
        description: 'Evaluate a numeric arithmetic expression. Supports +, -, *, /, %, ^, parentheses, and decimals.',
        risk: 'read',
        input_schema: {
          type: 'object',
          required: ['expression'],
          properties: {
            expression: { type: 'string', description: 'Arithmetic expression to evaluate.' },
          },
        },
      },
      execute: async (input) => {
        const expression = requireString(asObject(input).expression, 'expression').trim()
        if (!expression) throw new Error('expression is required.')
        const result = evaluateArithmetic(expression)
        return {
          content: `${expression} = ${result}`,
          metadata: {
            summary: String(result),
          },
        }
      },
    }
  }

  private createWeatherTool(): ChatToolHandler {
    return {
      definition: {
        name: 'get_weather',
        description: 'Get current weather for a city or place using a public weather API. Use this for weather questions.',
        risk: 'external',
        input_schema: {
          type: 'object',
          required: ['location'],
          properties: {
            location: { type: 'string', description: 'City or place name, for example "Shanghai" or "北京".' },
          },
        },
      },
      execute: async (input, context) => {
        const location = requireString(asObject(input).location, 'location').trim()
        if (!location) throw new Error('location is required.')

        const geoUrl = new URL('https://geocoding-api.open-meteo.com/v1/search')
        geoUrl.searchParams.set('name', location)
        geoUrl.searchParams.set('count', '1')
        geoUrl.searchParams.set('language', 'zh')
        geoUrl.searchParams.set('format', 'json')

        const geo = await fetchJson<{
          results?: Array<{
            name?: string
            country?: string
            admin1?: string
            latitude?: number
            longitude?: number
            timezone?: string
          }>
        }>(geoUrl.toString(), context.signal)

        const match = geo.results?.[0]
        if (!match || typeof match.latitude !== 'number' || typeof match.longitude !== 'number') {
          return {
            content: `No weather location found for "${location}".`,
            isError: true,
            metadata: { summary: 'Location not found' },
          }
        }

        const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast')
        forecastUrl.searchParams.set('latitude', String(match.latitude))
        forecastUrl.searchParams.set('longitude', String(match.longitude))
        forecastUrl.searchParams.set('current', [
          'temperature_2m',
          'relative_humidity_2m',
          'apparent_temperature',
          'precipitation',
          'weather_code',
          'wind_speed_10m',
        ].join(','))
        forecastUrl.searchParams.set('timezone', 'auto')
        forecastUrl.searchParams.set('forecast_days', '1')

        const forecast = await fetchJson<{
          current?: Record<string, unknown>
          current_units?: Record<string, string>
          timezone?: string
        }>(forecastUrl.toString(), context.signal)

        const current = forecast.current ?? {}
        const units = forecast.current_units ?? {}
        const code = numberFromUnknown(current.weather_code)
        const place = [match.name, match.admin1, match.country].filter(Boolean).join(', ')
        const content = [
          `Location: ${place || location}`,
          `Time: ${typeof current.time === 'string' ? current.time : 'unknown'} (${forecast.timezone || match.timezone || 'local'})`,
          `Weather: ${describeWeatherCode(code)}`,
          formatMetric('Temperature', current.temperature_2m, units.temperature_2m),
          formatMetric('Feels like', current.apparent_temperature, units.apparent_temperature),
          formatMetric('Humidity', current.relative_humidity_2m, units.relative_humidity_2m),
          formatMetric('Precipitation', current.precipitation, units.precipitation),
          formatMetric('Wind speed', current.wind_speed_10m, units.wind_speed_10m),
        ].filter(Boolean).join('\n')

        return {
          content,
          metadata: {
            summary: `${place || location}: ${formatMetric('', current.temperature_2m, units.temperature_2m).trim()}`,
          },
        }
      },
    }
  }

  private createWebSearchTool(): ChatToolHandler {
    return {
      definition: {
        name: 'web_search',
        description: 'Search the public web for current information. Returns a small set of result titles, snippets, and URLs.',
        risk: 'external',
        input_schema: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', description: 'Search query.' },
            max_results: { type: 'number', description: 'Maximum results to return.' },
          },
        },
      },
      execute: async (input, context) => {
        const obj = asObject(input)
        const query = requireString(obj.query, 'query').trim()
        if (!query) throw new Error('query is required.')
        const maxResults = clampNumber(obj.max_results, 1, 10, DEFAULT_MAX_SEARCH_RESULTS)

        const url = new URL('https://api.duckduckgo.com/')
        url.searchParams.set('q', query)
        url.searchParams.set('format', 'json')
        url.searchParams.set('no_html', '1')
        url.searchParams.set('skip_disambig', '1')

        const data = await fetchJson<Record<string, unknown>>(url.toString(), context.signal)
        const results = extractDuckDuckGoResults(data).slice(0, maxResults)
        if (results.length === 0) {
          return {
            content: `No web search results returned for "${query}".`,
            metadata: { summary: '0 results', matches: 0 },
          }
        }

        return {
          content: results
            .map((result, index) => [
              `${index + 1}. ${result.title}`,
              result.url ? `   URL: ${result.url}` : '',
              result.snippet ? `   ${result.snippet}` : '',
            ].filter(Boolean).join('\n'))
            .join('\n\n'),
          metadata: {
            summary: results.length === 1 ? '1 result' : `${results.length} results`,
            matches: results.length,
          },
        }
      },
    }
  }

  private createWebFetchTool(): ChatToolHandler {
    return {
      definition: {
        name: 'web_fetch',
        description: 'Fetch a public web page by URL and return readable text. Use after web_search when a result needs inspection.',
        risk: 'external',
        input_schema: {
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string', description: 'HTTP or HTTPS URL.' },
            max_chars: { type: 'number', description: 'Maximum characters of readable text to return.' },
          },
        },
      },
      execute: async (input, context) => {
        const obj = asObject(input)
        const targetUrl = requireUrl(requireString(obj.url, 'url'))
        const maxChars = clampNumber(obj.max_chars, 500, MAX_FETCH_CHARS, 6000)
        const response = await fetch(targetUrl, {
          signal: context.signal,
          headers: {
            'User-Agent': 'Ycode Desktop/1.0',
            Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.8',
          },
        })

        if (!response.ok) {
          return {
            content: `Fetch failed with HTTP ${response.status}.`,
            isError: true,
            metadata: { summary: `HTTP ${response.status}` },
          }
        }

        const raw = await response.text()
        const contentType = response.headers.get('content-type') ?? ''
        const text = contentType.includes('html') ? htmlToText(raw) : raw
        const normalized = text.replace(/\n{3,}/g, '\n\n').trim()
        const truncated = normalized.length > maxChars
        return {
          content: truncated ? `${normalized.slice(0, maxChars)}\n\n[truncated]` : normalized,
          metadata: {
            summary: truncated ? `Fetched ${maxChars}+ chars` : `${normalized.length} chars`,
            outputTruncated: truncated,
          },
        }
      },
    }
  }
}

function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  return fetch(url, {
    signal,
    headers: {
      'User-Agent': 'Ycode Desktop/1.0',
      Accept: 'application/json',
    },
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Request failed with HTTP ${response.status}.`)
    }
    return (await response.json()) as T
  })
}

type SearchResult = {
  title: string
  snippet: string
  url: string
}

function extractDuckDuckGoResults(data: Record<string, unknown>): SearchResult[] {
  const results: SearchResult[] = []
  const heading = stringFromUnknown(data.Heading)
  const abstractText = stringFromUnknown(data.AbstractText)
  const abstractUrl = stringFromUnknown(data.AbstractURL)
  if (heading || abstractText || abstractUrl) {
    results.push({
      title: heading || abstractUrl || 'DuckDuckGo result',
      snippet: abstractText,
      url: abstractUrl,
    })
  }

  const related = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : []
  for (const item of related) {
    collectRelatedTopic(item, results)
  }

  return results.filter((result, index, all) =>
    result.title &&
    all.findIndex((entry) => entry.title === result.title && entry.url === result.url) === index,
  )
}

function collectRelatedTopic(item: unknown, results: SearchResult[]): void {
  if (!item || typeof item !== 'object') return
  const obj = item as Record<string, unknown>
  if (Array.isArray(obj.Topics)) {
    for (const nested of obj.Topics) collectRelatedTopic(nested, results)
    return
  }

  const text = stringFromUnknown(obj.Text)
  const firstUrl = stringFromUnknown(obj.FirstURL)
  if (!text && !firstUrl) return

  const [title, ...rest] = text.split(' - ')
  results.push({
    title: title || firstUrl || 'Search result',
    snippet: rest.join(' - '),
    url: firstUrl,
  })
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|section|article|h[1-6]|li|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
}

function asObject(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? input as Record<string, unknown> : {}
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`)
  return value
}

function requireUrl(value: string): string {
  const parsed = new URL(value)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS URLs are supported.')
  }
  return parsed.toString()
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function numberFromUnknown(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringFromUnknown(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function formatMetric(label: string, value: unknown, unit?: string): string {
  if (typeof value !== 'number' && typeof value !== 'string') return ''
  return `${label ? `${label}: ` : ''}${value}${unit ? ` ${unit}` : ''}`
}

function describeWeatherCode(code: number | undefined): string {
  if (code === undefined) return 'unknown'
  if (code === 0) return 'Clear sky'
  if ([1, 2, 3].includes(code)) return 'Partly cloudy'
  if ([45, 48].includes(code)) return 'Fog'
  if ([51, 53, 55, 56, 57].includes(code)) return 'Drizzle'
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'Rain'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snow'
  if ([95, 96, 99].includes(code)) return 'Thunderstorm'
  return `Weather code ${code}`
}

type Token =
  | { type: 'number'; value: number }
  | { type: 'operator'; value: '+' | '-' | '*' | '/' | '%' | '^' }
  | { type: 'paren'; value: '(' | ')' }

type OperatorValue = '+' | '-' | '*' | '/' | '%' | '^' | 'u-' | '('

function evaluateArithmetic(expression: string): number {
  const tokens = tokenizeArithmetic(expression)
  const values: number[] = []
  const operators: OperatorValue[] = []
  let previous: Token | null = null

  for (const token of tokens) {
    if (token.type === 'number') {
      values.push(token.value)
      previous = token
      continue
    }

    if (token.type === 'paren') {
      if (token.value === '(') {
        operators.push('(')
        previous = token
        continue
      }

      while (operators.length > 0 && operators.at(-1)! !== '(') {
        applyTopOperator(values, operators)
      }
      if (operators.length === 0) throw new Error('Mismatched parentheses.')
      operators.pop()
      previous = token
      continue
    }

    const operator =
      token.value === '-' &&
      (!previous || (previous.type === 'operator') || (previous.type === 'paren' && previous.value === '('))
        ? 'u-'
        : token.value

    while (
      operators.length > 0 &&
      operators.at(-1)! !== '(' &&
      shouldApplyBefore(operators.at(-1)!, operator)
    ) {
      applyTopOperator(values, operators)
    }
    operators.push(operator)
    previous = token
  }

  while (operators.length > 0) {
    if (operators.at(-1)! === '(') throw new Error('Mismatched parentheses.')
    applyTopOperator(values, operators)
  }

  if (values.length !== 1 || !Number.isFinite(values[0]!)) {
    throw new Error('Invalid arithmetic expression.')
  }
  return values[0]!
}

function tokenizeArithmetic(expression: string): Token[] {
  const tokens: Token[] = []
  let index = 0

  while (index < expression.length) {
    const char = expression[index]!
    if (/\s/.test(char)) {
      index++
      continue
    }
    if ('()+-*/%^'.includes(char)) {
      if (char === '(' || char === ')') {
        tokens.push({ type: 'paren', value: char })
      } else {
        tokens.push({ type: 'operator', value: char as Token['value'] & ('+' | '-' | '*' | '/' | '%' | '^') })
      }
      index++
      continue
    }

    const match = expression.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i)
    if (!match) throw new Error(`Unsupported character in expression: ${char}`)
    tokens.push({ type: 'number', value: Number(match[0]) })
    index += match[0].length
  }

  return tokens
}

function shouldApplyBefore(existing: OperatorValue, incoming: OperatorValue): boolean {
  const precedence: Record<Exclude<OperatorValue, '('>, number> = {
    '+': 1,
    '-': 1,
    '*': 2,
    '/': 2,
    '%': 2,
    '^': 3,
    'u-': 4,
  }
  if (incoming === '^' || incoming === 'u-') {
    return precedence[existing as Exclude<OperatorValue, '('>] > precedence[incoming]
  }
  return precedence[existing as Exclude<OperatorValue, '('>] >= precedence[incoming]
}

function applyTopOperator(
  values: number[],
  operators: OperatorValue[],
): void {
  const operator = operators.pop()!
  if (operator === 'u-') {
    if (values.length < 1) throw new Error('Invalid unary operator.')
    values.push(-values.pop()!)
    return
  }

  if (values.length < 2) throw new Error('Invalid arithmetic expression.')
  const right = values.pop()!
  const left = values.pop()!
  switch (operator) {
    case '+':
      values.push(left + right)
      return
    case '-':
      values.push(left - right)
      return
    case '*':
      values.push(left * right)
      return
    case '/':
      values.push(left / right)
      return
    case '%':
      values.push(left % right)
      return
    case '^':
      values.push(left ** right)
      return
  }
}

function withDuration(
  result: ToolExecutionResult,
  startedAt: number,
): ToolExecutionResult {
  const metadata: ToolExecutionMetadata = {
    ...result.metadata,
    durationMs: Date.now() - startedAt,
  }
  return { ...result, metadata }
}

export const chatToolRuntime = new ChatToolRuntime()
