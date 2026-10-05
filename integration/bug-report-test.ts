import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import getPort from "get-port";

import { js } from "./helpers/create-fixture.js";
import {
  createProject,
  dev,
  reactRouterConfig,
  viteConfig,
} from "./helpers/vite.js";

////////////////////////////////////////////////////////////////////////////////
// 👋 Hola! I'm here to help you write a great bug report pull request.
//
// You don't need to fix the bug, this is just to report one.
//
// The pull request you are submitting is supposed to fail when created, to let
// the team see the erroneous behavior, and understand what's going wrong.
//
// If you happen to have a fix as well, it will have to be applied in a subsequent
// commit to this pull request, and your now-succeeding test will have to be moved
// to the appropriate file.
//
// First, make sure to install dependencies and build React Router. From the root of
// the project, run this:
//
//    ```
//    pnpm install && pnpm build
//    ```
//
// If you have never installed playwright on your system before, you may also need
// to install a browser engine:
//
//    ```
//    pnpm exec playwright install chromium
//    ```
//
// Now try running this test:
//
//    ```
//    pnpm test:integration bug-report --project chromium
//    ```
//
// You can add `--watch` to the end to have it re-run on file changes:
//
//    ```
//    pnpm test:integration bug-report --project chromium --watch
//    ```
////////////////////////////////////////////////////////////////////////////////

let stop: (() => unknown) | undefined;

test.afterEach(() => stop?.());

// This bug only reproduces against the dev server, so instead of
// `createFixture`/`createAppFixture` (which build the app), this starts
// `react-router dev` and requests a document directly. Each route module
// records when the server evaluates it.
async function getSsrRouteImports(prerender: string[] | undefined) {
  let port = await getPort();
  let cwd = await createProject({
    "vite.config.js": await viteConfig.basic({ port }),
    "react-router.config.ts": reactRouterConfig({ ssr: false, prerender }),
    "app/routeImportTracker.ts": js`
      // Records route module evaluation on the server only, synchronously
      // so it can't race the document response
      export function logImport(url: string) {
        if (typeof document !== "undefined") return;
        const fs = process.getBuiltinModule("node:fs");
        fs.appendFileSync(process.cwd() + "/ssr-route-imports.txt", url + "\n");
      }
    `,
    "app/root.tsx": js`
      import { Links, Meta, Outlet, Scripts } from "react-router";
      import { logImport } from "./routeImportTracker";
      logImport("app/root.tsx");

      export default function Root() {
        return (
          <html lang="en">
            <head>
              <Meta />
              <Links />
            </head>
            <body>
              <Outlet />
              <Scripts />
            </body>
          </html>
        );
      }

      export function HydrateFallback() {
        return <p>Loading...</p>;
      }
    `,
    "app/routes/_index.tsx": js`
      import { logImport } from "../routeImportTracker";
      logImport("app/routes/_index.tsx");

      export default function Component() {
        return <h2>Index</h2>;
      }
    `,
    "app/routes/about.tsx": js`
      import { logImport } from "../routeImportTracker";
      logImport("app/routes/about.tsx");

      export default function Component() {
        return <h2>About</h2>;
      }
    `,
  });

  stop = await dev({ cwd, port });
  let res = await fetch(`http://localhost:${port}/`);
  expect(res.status).toBe(200);
  await res.text();

  let imports = await fs.promises.readFile(
    path.join(cwd, "ssr-route-imports.txt"),
    "utf-8",
  );
  return imports.trim().split("\n").sort();
}

////////////////////////////////////////////////////////////////////////////////
// 💿 Almost done, now write your failing test case(s) down here Make sure to
// add a good description for what you expect React Router to do 👇🏽
////////////////////////////////////////////////////////////////////////////////

// Passes: in SPA Mode, non-root routes are stubbed out of the server build.
test("ssr:false dev server only imports the root route without a prerender config (SPA Mode)", async () => {
  expect(await getSsrRouteImports(undefined)).toStrictEqual(["app/root.tsx"]);
});

// Fails: with any prerender config, every route module is imported into the
// server build, including routes no prerender path ever matches. In large apps
// this makes the first dev request evaluate the entire app on the server.
test("ssr:false dev server only imports routes matched by prerender paths", async () => {
  expect(await getSsrRouteImports(["/"])).toStrictEqual([
    "app/root.tsx",
    "app/routes/_index.tsx",
    // app/routes/about.tsx is never pre-rendered, so it should not be imported
  ]);
});

////////////////////////////////////////////////////////////////////////////////
// 💿 Finally, push your changes to your fork of React Router
// and open a pull request!
////////////////////////////////////////////////////////////////////////////////
