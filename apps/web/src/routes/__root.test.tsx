// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  type ErrorComponentProps,
  type ErrorRouteComponent,
  type RouteComponent,
} from "@tanstack/react-router";
import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { Route as RootRoute } from "./__root";
import { AppAtomRegistryProvider } from "../rpc/atomRegistry";

function getRootView(): RouteComponent {
  const component = RootRoute.options.component;
  if (!component) {
    throw new Error("root route has no component under test");
  }
  return component;
}

const RootView = getRootView();

function getRootErrorComponent(): ErrorRouteComponent {
  const component = RootRoute.options.errorComponent;
  if (!component) {
    throw new Error("root route has no errorComponent under test");
  }
  return component;
}

const rootErrorComponent = getRootErrorComponent();

// Exact dynamic-import failure from the Nightly→Stable report.
const STALE_SETTINGS_CHUNK = new TypeError(
  "Failed to fetch dynamically imported module: t3code://app/assets/settings-C9snXPCM.js",
);

let renderer: ReactTestRenderer | undefined;
let reload: ReturnType<typeof vi.fn>;
let originalLocation: Location;

function visibleText(): string {
  return JSON.stringify(renderer?.toJSON() ?? null);
}

async function renderElement(element: React.ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  // No StrictMode: the recovering view decides in a state initializer that
  // performs the guarded reload, and StrictMode's double-invoke would
  // consume the single-shot guard before the assertion.
  await act(() => {
    renderer = create(<RouterProvider router={router} />);
  });
}

function renderErrorView(error: Error) {
  const props = { error, reset: () => undefined } satisfies ErrorComponentProps;
  return renderElement(createElement(rootErrorComponent, props));
}

async function renderFailingRoute(error: Error) {
  const rootRoute = createRootRoute({
    component: () => <Outlet />,
    errorComponent: rootErrorComponent,
  });
  const failingRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => {
      throw error;
    },
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([failingRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  await act(() => {
    renderer = create(<RouterProvider router={router} />);
  });
}

async function renderSuccessfulRootView() {
  const rootRoute = createRootRoute({
    beforeLoad: () => ({ authGateState: { status: "hosted-static" } }),
    component: () => (
      <AppAtomRegistryProvider>
        <RootView />
      </AppAtomRegistryProvider>
    ),
  });
  const pairRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/pair",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([pairRoute]),
    history: createMemoryHistory({ initialEntries: ["/pair"] }),
  });
  await router.load();
  await act(() => {
    renderer = create(<RouterProvider router={router} />);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // The chunk guard persists in sessionStorage: isolate each case.
  window.sessionStorage.clear();
  reload = vi.fn();
  originalLocation = window.location;
  // jsdom's reload navigates (unimplemented); observe it instead while
  // keeping href and friends intact through the prototype chain.
  const stub = Object.create(originalLocation, {
    reload: { value: reload, configurable: true, writable: true },
  });
  Object.defineProperty(window, "location", {
    value: stub,
    configurable: true,
    writable: true,
  });
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  Object.defineProperty(window, "location", {
    value: originalLocation,
    configurable: true,
    writable: true,
  });
  vi.unstubAllGlobals();
});

describe("root route stale chunk recovery", () => {
  it("reloads once instead of showing the dead error screen", async () => {
    await renderErrorView(STALE_SETTINGS_CHUNK);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(visibleText()).toContain("Updating app");
    expect(visibleText()).not.toContain("Something went wrong");
  });

  it("recovers through the real router error path exactly once", async () => {
    await renderFailingRoute(STALE_SETTINGS_CHUNK);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("re-arms the guard after a successful commit, still without looping", async () => {
    // Boot 1: a stale chunk on a fresh streak reloads once.
    await renderFailingRoute(STALE_SETTINGS_CHUNK);
    expect(reload).toHaveBeenCalledTimes(1);

    // Boot 2: the app boots cleanly. Only a successful commit may re-arm the
    // guard — clearing it any earlier (e.g. in the startup continuation,
    // before the error boundary runs) turns a persistent failure into a
    // reload loop.
    await act(() => renderer?.unmount());
    await renderSuccessfulRootView();

    // Boot 3: a later stale chunk reloads once more instead of wedging…
    await act(() => renderer?.unmount());
    await renderFailingRoute(STALE_SETTINGS_CHUNK);
    expect(reload).toHaveBeenCalledTimes(2);

    // …while a repeat failure in the same streak still surfaces.
    await act(() => renderer?.unmount());
    await renderFailingRoute(STALE_SETTINGS_CHUNK);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(visibleText()).toContain("Something went wrong");
  });

  it("leaves ordinary route errors alone", async () => {
    await renderFailingRoute(new Error("boom"));

    expect(reload).not.toHaveBeenCalled();
    expect(visibleText()).toContain("Something went wrong");
    expect(visibleText()).toContain("boom");
  });
});
