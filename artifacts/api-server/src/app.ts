import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger";

const app: Express = express();
const FASTAPI_URL = (process.env.FASTAPI_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * Transparent proxy middleware that forwards requests to the FastAPI backend.
 * Express serves solely as a thin proxy for workspace compatibility.
 */
async function proxyToFastApi(req: Request, res: Response) {
  const targetUrl = new URL(req.originalUrl || req.url, FASTAPI_URL);

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (
      key.toLowerCase() !== "host" &&
      key.toLowerCase() !== "connection" &&
      typeof value === "string"
    ) {
      headers[key] = value;
    }
  }

  try {
    const fetchOptions: RequestInit = {
      method: req.method,
      headers,
    };

    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method.toUpperCase())) {
      if (req.body && Object.keys(req.body).length > 0) {
        fetchOptions.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
        if (!headers["content-type"]) {
          headers["content-type"] = "application/json";
        }
      }
    }

    const upstreamRes = await fetch(targetUrl.toString(), fetchOptions);
    res.status(upstreamRes.status);

    upstreamRes.headers.forEach((value, key) => {
      if (
        key.toLowerCase() !== "content-encoding" &&
        key.toLowerCase() !== "transfer-encoding"
      ) {
        res.setHeader(key, value);
      }
    });

    const responseData = await upstreamRes.arrayBuffer();
    res.send(Buffer.from(responseData));
  } catch (err: unknown) {
    logger.error(
      { err, targetUrl: targetUrl.toString() },
      "FastAPI backend unavailable at target URL",
    );
    res.status(502).json({
      detail: "FastAPI backend is currently unavailable.",
      targetUrl: targetUrl.toString(),
    });
  }
}

// Forward /api/*, /docs, /openapi.json to FastAPI
app.use("/api", proxyToFastApi);
app.use("/docs", proxyToFastApi);
app.use("/openapi.json", proxyToFastApi);

export default app;
