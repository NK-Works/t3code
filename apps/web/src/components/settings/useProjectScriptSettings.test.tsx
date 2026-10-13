import type {
  EnvironmentId,
  ProjectScript,
  ResolvedKeybindingsConfig,
  ServerSettings,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { NewProjectScriptInput } from "../projectScriptEditor";
import { useProjectScriptSettings } from "./useProjectScriptSettings";

const stubs = vi.hoisted(() => ({
  serverEnvironment: {
    updateSettings: { label: "updateSettings" },
    upsertKeybinding: { label: "upsertKeybinding" },
    removeKeybinding: { label: "removeKeybinding" },
  },
  updateSettings: vi.fn(),
  upsertKeybinding: vi.fn(),
  removeKeybinding: vi.fn(),
  toastAdd: vi.fn(),
  settingsWrite: true,
}));

vi.mock("../../state/server", () => ({
  serverEnvironment: stubs.serverEnvironment,
}));

vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) => {
    if (command === stubs.serverEnvironment.updateSettings) return stubs.updateSettings;
    if (command === stubs.serverEnvironment.upsertKeybinding) return stubs.upsertKeybinding;
    if (command === stubs.serverEnvironment.removeKeybinding) return stubs.removeKeybinding;
    throw new Error("unexpected atom command");
  },
}));

vi.mock("../../state/entities", () => ({
  useProjects: () => [],
}));

vi.mock("../../state/session", () => ({
  readEnvironmentScope: () => stubs.settingsWrite,
}));

vi.mock("../ui/toast", () => ({
  toastManager: { add: stubs.toastAdd },
}));

const ENVIRONMENT_ID = "env-1" as EnvironmentId;

type Targets = Parameters<typeof useProjectScriptSettings>[0];
type Hook = ReturnType<typeof useProjectScriptSettings>;

function settingsWith(scripts: readonly ProjectScript[]): ServerSettings {
  return {
    defaultProjectScripts: [...scripts],
    projectSettingsOverrides: {},
  } as unknown as ServerSettings;
}

function targetsWith(scripts: readonly ProjectScript[], keybindings: ResolvedKeybindingsConfig) {
  return [
    {
      environmentId: ENVIRONMENT_ID,
      settings: settingsWith(scripts),
      keybindings,
    },
  ] as Targets;
}

function scriptInput(overrides?: Partial<NewProjectScriptInput>): NewProjectScriptInput {
  return {
    name: "Lint",
    command: "echo lint",
    icon: "play",
    runOnWorktreeCreate: false,
    waitForSetup: false,
    runOnSettle: false,
    keybinding: "mod+k",
    previewUrl: null,
    autoOpenPreview: false,
    ...overrides,
  };
}

function Harness({ targets, hookRef }: { targets: Targets; hookRef: { current: Hook | null } }) {
  const hook = useProjectScriptSettings(targets);
  useEffect(() => {
    hookRef.current = hook;
  }, [hook, hookRef]);
  return null;
}

let renderer: ReactTestRenderer | null;
let hookRef: { current: Hook | null };

function renderHook(targets: Targets) {
  hookRef = { current: null };
  act(() => {
    renderer = create(<Harness targets={targets} hookRef={hookRef} />);
  });
  if (!hookRef.current) throw new Error("hook did not render");
  return hookRef as { current: Hook };
}

async function submitCurrent(
  hook: { current: Hook },
  scriptId: string | null,
  input: NewProjectScriptInput,
) {
  let result!: Awaited<ReturnType<Hook["submit"]>>;
  await act(async () => {
    result = await hook.current.submit(scriptId, input);
  });
  return result;
}

beforeEach(() => {
  renderer = null;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  stubs.updateSettings.mockReset();
  stubs.upsertKeybinding.mockReset();
  stubs.removeKeybinding.mockReset();
  stubs.toastAdd.mockReset();
  stubs.settingsWrite = true;
  stubs.updateSettings.mockResolvedValue(AsyncResult.success(undefined));
  stubs.upsertKeybinding.mockResolvedValue(AsyncResult.success(undefined));
  stubs.removeKeybinding.mockResolvedValue(AsyncResult.success(undefined));
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});

describe("useProjectScriptSettings action shortcuts", () => {
  it("saves a new shortcut through the keybinding RPC outside Electron", async () => {
    const hook = renderHook(targetsWith([], [] as ResolvedKeybindingsConfig));

    const result = await submitCurrent(hook, null, scriptInput());

    expect(result._tag).toBe("Success");
    expect(stubs.updateSettings).toHaveBeenCalledTimes(1);
    // Regression test for https://github.com/pingdotgg/t3code/issues/18427:
    // the shortcut write must not be skipped in a browser client.
    expect(stubs.upsertKeybinding).toHaveBeenCalledTimes(1);
    expect(stubs.upsertKeybinding).toHaveBeenCalledWith({
      environmentId: ENVIRONMENT_ID,
      input: { key: "mod+k", command: "script.lint.run" },
    });
    expect(stubs.removeKeybinding).not.toHaveBeenCalled();
  });

  it("removes a cleared shortcut through the keybinding RPC outside Electron", async () => {
    const existing: ProjectScript = {
      id: "lint",
      name: "Lint",
      command: "echo lint",
      icon: "play",
      runOnWorktreeCreate: false,
    };
    const keybindings = [
      {
        command: "script.lint.run",
        shortcut: {
          key: "k",
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          modKey: true,
        },
      },
    ] as unknown as ResolvedKeybindingsConfig;
    const hook = renderHook(targetsWith([existing], keybindings));

    const result = await submitCurrent(hook, "lint", scriptInput({ keybinding: null }));

    expect(result._tag).toBe("Success");
    expect(stubs.updateSettings).toHaveBeenCalledTimes(1);
    expect(stubs.upsertKeybinding).not.toHaveBeenCalled();
    expect(stubs.removeKeybinding).toHaveBeenCalledTimes(1);
    expect(stubs.removeKeybinding).toHaveBeenCalledWith({
      environmentId: ENVIRONMENT_ID,
      input: { key: "mod+k", command: "script.lint.run" },
    });
  });

  it("skips the shortcut write when the settings write fails", async () => {
    stubs.updateSettings.mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new Error("settings write failed"))),
    );
    const hook = renderHook(targetsWith([], [] as ResolvedKeybindingsConfig));

    const result = await submitCurrent(hook, null, scriptInput());

    expect(result._tag).toBe("Failure");
    expect(stubs.upsertKeybinding).not.toHaveBeenCalled();
    expect(stubs.removeKeybinding).not.toHaveBeenCalled();
  });

  it("fails with a clear scope error instead of silently dropping the save", async () => {
    stubs.settingsWrite = false;
    const hook = renderHook(targetsWith([], [] as ResolvedKeybindingsConfig));

    const result = await submitCurrent(hook, null, scriptInput());

    expect(result._tag).toBe("Failure");
    expect(stubs.updateSettings).not.toHaveBeenCalled();
    expect(stubs.upsertKeybinding).not.toHaveBeenCalled();
    expect(stubs.removeKeybinding).not.toHaveBeenCalled();
    expect(stubs.toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Failed to save project actions" }),
    );
  });
});
