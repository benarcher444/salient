import "./env.js"; // FIRST: loads .env before any module reads process.env. See env.ts.
import path from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { pruneSessions } from "./auth.js";
import { bundle, prebuildBundles } from "./client-bundle.js";
import { config } from "./config.js";
import { currentUser } from "./context.js";
import { runMigrations } from "./db/migrate.js";
import { resumeBots } from "./games.js";
import { authRoutes } from "./routes/auth.js";
import { gameRoutes } from "./routes/games.js";
import { mapRoutes } from "./routes/maps.js";
import { settingsRoutes } from "./routes/settings.js";
import { layout } from "./views/layout.js";
import { notFoundPage } from "./views/pages.js";

runMigrations();
pruneSessions();
if (config.isProduction) await prebuildBundles();

const app = Fastify({
  logger: { level: config.isProduction ? "info" : "warn" },
  // Believe X-Forwarded-For only from a proxy on this machine (Caddy). Then
  // request.ip is the visitor, for rate limiting, and request.protocol is
  // https, for the Secure cookie. The same headers from anyone else are ignored.
  trustProxy: "127.0.0.1,::1",
});

await app.register(cookie);
await app.register(formbody);
await app.register(websocket);

// Bundled browser code, before the static handler so /static/build/* is ours.
app.get("/static/build/:name", async (request, reply) => {
  const code = await bundle((request.params as { name: string }).name);
  if (code === null) return reply.code(404).send("not found");
  return reply.type("text/javascript; charset=utf-8").header("cache-control", "no-cache").send(code);
});

await app.register(fastifyStatic, {
  root: path.resolve("public"),
  prefix: "/static/",
  // Served fresh: a change to public/ is live on reload without a restart.
  cacheControl: false,
  etag: true,
});

authRoutes(app);
gameRoutes(app);
mapRoutes(app);
settingsRoutes(app);

app.setNotFoundHandler((request, reply) => reply.code(404).type("text/html; charset=utf-8").send(notFoundPage(currentUser(request))));

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  const code = (error as { statusCode?: number }).statusCode;
  const status = code && code < 500 ? code : 500;
  reply
    .code(status)
    .type("text/html; charset=utf-8")
    .send(layout({ title: "Error", user: null, body: `<div class="card empty"><h3>Something went wrong</h3><p>${status === 500 ? "The server hit an error. Try again in a moment." : "That request couldn't be handled."}</p><a class="btn btn-primary" href="/">Back to your games</a></div>` }));
});

await app.listen({ port: config.port, host: config.host });
resumeBots();
console.log(`Salient listening on http://${config.host}:${config.port}`);
