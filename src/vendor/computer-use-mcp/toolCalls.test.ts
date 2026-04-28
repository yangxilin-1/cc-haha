import { describe, expect, test } from "bun:test";

import { _test } from "./toolCalls";
import { getDefaultTierForApp } from "./deniedApps";
import { getSentinelCategory } from "./sentinelApps";
import type { InstalledApp } from "./executor";

function encodeElementId(payload: unknown): string {
  return `uia:${Buffer.from(JSON.stringify(payload), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")}`;
}

describe("Computer Use app resolution", () => {
  test("resolves QQ Music when Windows only exposes the English executable name", () => {
    const installed: InstalledApp[] = [
      {
        bundleId: "QQMusic",
        displayName: "QQMusic",
        path: "C:\\Program Files\\Tencent\\QQMusic\\QQMusic.exe",
      },
    ];

    const [resolved] = _test.resolveRequestedApps(
      ["QQ音乐"],
      installed,
      new Set(),
    );

    expect(resolved.resolved?.bundleId).toBe("QQMusic");
  });

  test("resolves the English request when the Start Menu shortcut is localized", () => {
    const installed: InstalledApp[] = [
      {
        bundleId: "QQMusic",
        displayName: "QQ音乐",
        path: "C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\QQ音乐.lnk",
      },
    ];

    const [resolved] = _test.resolveRequestedApps(
      ["QQMusic"],
      installed,
      new Set(),
    );

    expect(resolved.resolved?.displayName).toBe("QQ音乐");
  });

  test("matches open_application names against granted aliases", () => {
    const match = _test.findRequestedApp("QQ音乐", [
      { bundleId: "QQMusic", displayName: "QQMusic" },
    ]);

    expect(match?.bundleId).toBe("QQMusic");
  });

  test("deduplicates aliases that resolve to the same installed app", () => {
    const installed: InstalledApp[] = [
      {
        bundleId: "QQMusic",
        displayName: "QQ音乐",
        path: "C:\\Program Files\\Tencent\\QQMusic\\QQMusic.exe",
      },
    ];

    const resolved = _test.resolveRequestedApps(
      ["QQ音乐", "QQMusic"],
      installed,
      new Set(),
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0].resolved?.bundleId).toBe("QQMusic");
  });

  test("does not resolve Coder to VS Code by reverse substring", () => {
    const installed: InstalledApp[] = [
      {
        bundleId: "Code",
        displayName: "Visual Studio Code",
        path: "C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
      },
    ];

    const [resolved] = _test.resolveRequestedApps(
      ["Coder"],
      installed,
      new Set(),
    );

    expect(resolved.resolved).toBeUndefined();
  });

  test("resolves Qoder exactly instead of nearby code editors", () => {
    const installed: InstalledApp[] = [
      {
        bundleId: "Code",
        displayName: "Visual Studio Code",
        path: "C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
      },
      {
        bundleId: "Qoder",
        displayName: "Qoder",
        path: "E:\\Program Files\\Qoder\\Qoder.exe",
      },
    ];

    const [resolved] = _test.resolveRequestedApps(
      ["qoder"],
      installed,
      new Set(),
    );

    expect(resolved.resolved?.bundleId).toBe("Qoder");
  });

  test("treats Qoder bundle id casing as the same app", () => {
    const installed: InstalledApp[] = [
      {
        bundleId: "Qoder",
        displayName: "Qoder",
        path: "E:\\Program Files\\Qoder\\Qoder.exe",
      },
    ];

    const [resolved] = _test.resolveRequestedApps(
      ["Qoder"],
      installed,
      new Set(["qoder"]),
    );

    expect(resolved.resolved?.bundleId).toBe("Qoder");
    expect(resolved.alreadyGranted).toBe(true);

    const grant = _test.findGrantForApp(
      { bundleId: "Qoder", displayName: "Qoder.exe" },
      [{ bundleId: "qoder", displayName: "qoder", grantedAt: 1, tier: "full" }],
    );

    expect(grant?.bundleId).toBe("qoder");
  });

  test("treats arbitrary Windows app casing as the same app", () => {
    const installed: InstalledApp[] = [
      {
        bundleId: "AcmeTool",
        displayName: "Acme Tool",
        path: "C:\\Program Files\\Acme\\AcmeTool.exe",
      },
    ];

    const [resolved] = _test.resolveRequestedApps(
      ["acmetool"],
      installed,
      new Set(["ACMETOOL"]),
    );

    expect(resolved.resolved?.bundleId).toBe("AcmeTool");
    expect(resolved.alreadyGranted).toBe(true);
    expect(
      _test.findGrantForApp(
        { bundleId: "AcmeTool", displayName: "AcmeTool.exe" },
        [{ bundleId: "acmetool", displayName: "acmetool", grantedAt: 1, tier: "full" }],
      )?.tier,
    ).toBe("full");
  });

  test("uses case-insensitive app identity for tier and sentinel lookups", () => {
    expect(getDefaultTierForApp("COM.MICROSOFT.VSCODE", "VS Code")).toBe("click");
    expect(getDefaultTierForApp("COM.GOOGLE.CHROME", "Chrome")).toBe("read");
    expect(getSentinelCategory("COM.APPLE.FINDER")).toBe("filesystem");
  });
});

describe("Computer Use host app identity", () => {
  test("recognizes the Windows Ycode desktop process", () => {
    expect(
      _test.isHostApp(
        { bundleId: "Ycode", displayName: "Ycode.exe" },
        "com.ycode.desktop.no-window",
        "win32",
      ),
    ).toBe(true);
  });

  test("recognizes the pre-rebrand Windows desktop process", () => {
    expect(
      _test.isHostApp(
        {
          bundleId: "claude-code-desktop",
          displayName: "claude-code-desktop.exe",
        },
        "com.ycode.desktop.no-window",
        "win32",
      ),
    ).toBe(true);
  });

  test("does not use Windows host-name aliases on macOS", () => {
    expect(
      _test.isHostApp(
        {
          bundleId: "claude-code-desktop",
          displayName: "claude-code-desktop.exe",
        },
        "com.ycode.desktop.no-window",
        "darwin",
      ),
    ).toBe(false);
  });
});

describe("Computer Use computer-wide access", () => {
  test("uses the universal grant for any target app", () => {
    const grants = [
      {
        bundleId: "*",
        displayName: "All applications",
        grantedAt: 1,
        tier: "full" as const,
      },
    ];

    expect(_test.hasComputerWideAccess(grants)).toBe(true);
    expect(
      _test.findGrantForApp(
        { bundleId: "QQMusic", displayName: "QQMusic.exe" },
        grants,
      )?.tier,
    ).toBe("full");
  });
});

describe("Computer Use UI element ids", () => {
  test("decodes element ids from observe_desktop", () => {
    const elementId = encodeElementId({
      kind: "uia",
      bundleId: "QQMusic",
      displayName: "QQMusic.exe",
      bounds: { x: 10, y: 20, width: 200, height: 40 },
    });

    const parsed = _test.parseUiElementDescriptor(elementId);
    expect(parsed).not.toBeInstanceOf(Error);
    if (parsed instanceof Error) throw parsed;

    expect(parsed.bundleId).toBe("QQMusic");
    expect(_test.uiElementCenter(parsed)).toEqual({ x: 110, y: 40 });
  });

  test("rejects malformed element ids", () => {
    expect(_test.parseUiElementDescriptor("not-an-element")).toBeInstanceOf(
      Error,
    );
  });
});

describe("Computer Use desktop intent resolution", () => {
  test("resolves a QQ Music play instruction", () => {
    const resolved = _test.resolveDesktopIntent(
      { instruction: "打开 QQ 音乐播放晴天" },
      [{ bundleId: "QQMusic", displayName: "QQ音乐", tier: "full" }],
    );

    expect(resolved).not.toBeInstanceOf(Error);
    if (resolved instanceof Error) throw resolved;
    expect(resolved.kind).toBe("play_music");
    if (resolved.kind !== "play_music") throw new Error("unexpected intent");
    expect(resolved.app.bundleId).toBe("QQMusic");
    expect(resolved.query).toBe("晴天");
  });

  test("resolves spaced QQ Music wording from natural language", () => {
    const resolved = _test.resolveDesktopIntent(
      { instruction: "打开qq 音乐，播放晴天" },
      [{ bundleId: "QQMusic", displayName: "QQMusic", tier: "full" }],
    );

    expect(resolved).not.toBeInstanceOf(Error);
    if (resolved instanceof Error) throw resolved;
    expect(resolved.kind).toBe("play_music");
    if (resolved.kind !== "play_music") throw new Error("unexpected intent");
    expect(resolved.app.bundleId).toBe("QQMusic");
    expect(resolved.query).toBe("晴天");
  });

  test("allows explicit query and app for music intent", () => {
    const resolved = _test.resolveDesktopIntent(
      {
        instruction: "播放音乐",
        intent: "play_music",
        app: "QQMusic",
        query: "七里香",
      },
      [{ bundleId: "QQMusic", displayName: "QQMusic", tier: "full" }],
    );

    expect(resolved).not.toBeInstanceOf(Error);
    if (resolved instanceof Error) throw resolved;
    expect(resolved.kind).toBe("play_music");
    if (resolved.kind !== "play_music") throw new Error("unexpected intent");
    expect(resolved.query).toBe("七里香");
  });
});
