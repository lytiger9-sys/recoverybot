import { Router } from "express";
import { fileURLToPath } from "node:url";
import { findAdminSession } from "../../services/SessionService.js";
import { requireAdminPage } from "../../middleware/adminAuth.js";
const publicFile = (name) => fileURLToPath(new URL("../../../public/" + name, import.meta.url));
export const adminPageRoutes = Router();
adminPageRoutes.get("/login", async (request, response, next) => {
  try {
    if (await findAdminSession(request)) return response.redirect("/");
    return response.sendFile(publicFile("login.html"));
  } catch (error) {
    return next(error);
  }
});
adminPageRoutes.get("/", requireAdminPage, (_request, response) => response.sendFile(publicFile("index.html")));
adminPageRoutes.get("/hosts", requireAdminPage, (_request, response) => response.sendFile(publicFile("hosts.html")));
adminPageRoutes.get("/products", requireAdminPage, (_request, response) => response.sendFile(publicFile("products.html")));
adminPageRoutes.get(/^\/product\/(.+)$/, requireAdminPage, (_request, response) => response.sendFile(publicFile("product-detail.html")));
adminPageRoutes.get("/licenses", requireAdminPage, (_request, response) => response.sendFile(publicFile("licenses.html")));
adminPageRoutes.get("/auto-recharge", requireAdminPage, (_request, response) => response.sendFile(publicFile("auto-recharge.html")));
adminPageRoutes.get("/data", requireAdminPage, (_request, response) => response.sendFile(publicFile("data.html")));
adminPageRoutes.get("/recovery", requireAdminPage, (_request, response) => response.sendFile(publicFile("recovery.html")));
adminPageRoutes.get(/^\/db(\d+)info$/, requireAdminPage, async (request, response) => {
  const hostNumber = Number(request.params[0]);
  if (!Number.isSafeInteger(hostNumber) || hostNumber < 1 || hostNumber > 10000) return response.status(404).send("호기를 찾을 수 없습니다.");
  return response.sendFile(publicFile("host-db-info.html"));
});


