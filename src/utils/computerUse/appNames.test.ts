import { describe, expect, test } from 'bun:test'

import { filterAppsForDescription, filterAppsForSettings } from './appNames'

describe('filterAppsForDescription', () => {
  test('keeps Windows user-facing apps such as Qoder', () => {
    const names = filterAppsForDescription([
      {
        bundleId: 'qoder',
        displayName: 'Qoder',
        path: 'E:\\Program Files\\Qoder\\Qoder.exe',
      },
      {
        bundleId: 'vite',
        displayName: 'vite',
        path: 'D:\\repo\\app\\node_modules\\.bin\\vite.exe',
      },
    ], 'C:\\Users\\me')

    expect(names).toContain('Qoder')
    expect(names).not.toContain('vite')
  })

  test('keeps common apps case-insensitively', () => {
    const names = filterAppsForDescription([
      {
        bundleId: 'com.google.chrome',
        displayName: 'Google Chrome',
        path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      },
    ], 'C:\\Users\\me')

    expect(names).toContain('Google Chrome')
  })

  test('keeps apps discovered from desktop shortcuts', () => {
    const names = filterAppsForDescription([
      {
        bundleId: 'AcmeTool',
        displayName: 'Acme Tool',
        path: 'C:\\Users\\me\\Desktop\\Acme Tool.lnk',
      },
    ], 'C:\\Users\\me')

    expect(names).toContain('Acme Tool')
  })
})

describe('filterAppsForSettings', () => {
  test('keeps common apps first and filters registry components', () => {
    const apps = filterAppsForSettings([
      {
        bundleId: '{B2FE1952-0186-46C3-BAEC-A80AA35AC5B8}',
        displayName: 'Microsoft Visual C++ 2015-2022 Redistributable',
        path: 'C:\\Program Files (x86)\\Microsoft Visual C++\\vc_redist.x64.exe',
      },
      {
        bundleId: 'QQMusic',
        displayName: 'QQMusic',
        path: 'C:\\Program Files\\Tencent\\QQMusic\\QQMusic.exe',
      },
      {
        bundleId: 'Code',
        displayName: 'Visual Studio Code',
        path: 'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
      },
      {
        bundleId: 'NotepadPlusPlus',
        displayName: 'Notepad++',
        path: 'C:\\Program Files\\Notepad++\\notepad++.exe',
      },
      {
        bundleId: 'Uninstall-Anaconda3',
        displayName: 'Anaconda3 2025.12-2 (Python 3.13.9 64-bit)',
        path: 'C:\\Program Files\\Anaconda3\\Uninstall-Anaconda3.exe',
      },
      {
        bundleId: 'AggregatorHost',
        displayName: 'AggregatorHost',
        path: 'C:\\Windows\\System32\\AggregatorHost.exe',
      },
      {
        bundleId: '{B2FE1952-0186-46C3-BAEC-A80AA35AC5B8}_cufft_12.8',
        displayName: '${{arpDisplayName}}',
        path: 'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.8\\bin\\cufft.dll',
      },
    ], 'C:\\Users\\me')

    expect(apps.map(app => app.bundleId)).toEqual([
      'Code',
      'QQMusic',
      'NotepadPlusPlus',
    ])
    expect(apps.find(app => app.bundleId === 'QQMusic')?.category).toBe('音乐')
    expect(apps.some(app => app.displayName.includes('Redistributable'))).toBe(false)
    expect(apps.some(app => app.bundleId === 'Uninstall-Anaconda3')).toBe(false)
    expect(apps.some(app => app.bundleId === 'AggregatorHost')).toBe(false)
    expect(apps.some(app => app.displayName.includes('arpDisplayName'))).toBe(false)
  })

  test('keeps Python and Windows power tools while filtering uninstallers', () => {
    const apps = filterAppsForSettings([
      {
        bundleId: 'python',
        displayName: 'Python 3.13',
        path: 'C:\\Users\\me\\AppData\\Local\\Programs\\Python\\Python313\\python.exe',
      },
      {
        bundleId: 'powershell',
        displayName: 'Windows PowerShell',
        path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      },
      {
        bundleId: 'PowerToys',
        displayName: 'PowerToys',
        path: 'C:\\Program Files\\PowerToys\\PowerToys.exe',
      },
      {
        bundleId: 'Uninstall-Python',
        displayName: 'Uninstall Python 3.13',
        path: 'C:\\Users\\me\\AppData\\Local\\Programs\\Python\\Python313\\Uninstall.exe',
      },
    ], 'C:\\Users\\me')

    expect(apps.map(app => app.bundleId)).toContain('python')
    expect(apps.map(app => app.bundleId)).toContain('powershell')
    expect(apps.map(app => app.bundleId)).toContain('PowerToys')
    expect(apps.find(app => app.bundleId === 'python')?.category).toBe('Python')
    expect(apps.find(app => app.bundleId === 'powershell')?.category).toBe('Windows')
    expect(apps.some(app => app.bundleId === 'Uninstall-Python')).toBe(false)
  })

  test('keeps desktop shortcut apps in settings', () => {
    const apps = filterAppsForSettings([
      {
        bundleId: 'AcmeTool',
        displayName: 'Acme Tool',
        path: 'C:\\Users\\me\\Desktop\\Acme Tool.lnk',
      },
    ], 'C:\\Users\\me')

    expect(apps.map(app => app.bundleId)).toContain('AcmeTool')
  })
})
