import express from "express";
import path from "path";

export function startServer(port: number, publicDir: string): void {
  const app = express();

  app.get("/health", (_req, res) => {
    res.status(200).send("OK");
  });

  app.use(
    "/maps",
    express.static(path.join(publicDir, "maps"), {
      fallthrough: true,
      index: "index.html",
      extensions: ["html"],
    })
  );

  app.use(express.static(publicDir));

  app.get("/", (_req, res) => {
    res.status(200).send("GPX Telegram bot is running.");
  });

  app.listen(port, () => {
    console.log(`HTTP server listening on port ${port}`);
  });
}
