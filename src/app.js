import express from "express";
import { fileURLToPath } from "node:url";
import { healthRoute } from "./http/routes/healthRoute.js";
import { authRoutes } from "./http/routes/authRoutes.js";
import { hostRoutes } from "./http/routes/hostRoutes.js";
import { productRoutes } from "./http/routes/productRoutes.js";
import { licenseRoutes } from "./http/routes/licenseRoutes.js";
import { userRoutes } from "./http/routes/userRoutes.js";
import { dataRoutes } from "./http/routes/dataRoutes.js";
import { autoRechargeRoutes } from "./http/routes/autoRechargeRoutes.js";
import { adminPageRoutes } from "./http/routes/adminPageRoutes.js";
import { oauthRoutes } from "./http/routes/oauthRoutes.js";
import { recoveryRoutes } from "./http/routes/recoveryRoutes.js";
import { dashboardFinanceRoutes } from "./http/routes/dashboardFinanceRoutes.js";

const assetDirectory = fileURLToPath(new URL("../public/assets/", import.meta.url));

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);

  app.use((_request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' https: data:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
    next();
  });

  app.use(express.json({ limit: "20mb" }));
  app.use(express.urlencoded({ extended: false, limit: "10kb" }));
  app.use("/assets", express.static(assetDirectory, { index: false }));
  app.use("/api", healthRoute);
  app.use("/oauth", oauthRoutes);
  app.use("/api/admin/recovery", recoveryRoutes);
  app.use("/api/admin/dashboard/finance", dashboardFinanceRoutes);
  app.use("/api/auth", authRoutes);
  app.use("/api/admin/hosts", hostRoutes);
  app.use("/api/admin/products", productRoutes);
  app.use("/api/admin/licenses", licenseRoutes);
  app.use("/api/admin/users", userRoutes);
  app.use("/api/admin/data", dataRoutes);
  app.use("/api/admin/auto-recharge", autoRechargeRoutes);
  app.use(adminPageRoutes);

  app.use((error, _request, response, _next) => {
    if (error?.code === 11000) return response.status(409).json({ error: "중복된 항목이 있습니다." });
    console.error("Request failed:", error?.name ?? "UnknownError");
    return response.status(500).json({ error: "서버에서 요청을 처리하지 못했습니다." });
  });

  return app;
}




