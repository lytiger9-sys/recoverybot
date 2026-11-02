import { Router } from "express";
import mongoose from "mongoose";
import { BotHost } from "../../models/BotHost.js";
import { RestoredUser } from "../../models/RestoredUser.js";
import { requireAdmin } from "../../middleware/adminAuth.js";

export const userRoutes = Router();
userRoutes.use(requireAdmin);

function parseHostIds(raw) {
  const values = (Array.isArray(raw) ? raw : [raw])
    .flatMap((value) => String(value ?? "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  if (!values.length || values.length > 50 || values.some((id) => !mongoose.isValidObjectId(id))) return null;
  return [...new Set(values)];
}

userRoutes.get("/", async (request, response) => {
  const hostIds = parseHostIds(request.query.hostIds);
  if (!hostIds) return response.status(400).json({ error: "호기를 하나 이상 선택해 주세요." });

  const requestedPage = Number(request.query.page ?? 1);
  if (!Number.isInteger(requestedPage) || requestedPage < 1) {
    return response.status(400).json({ error: "페이지 번호가 올바르지 않습니다." });
  }

  const pageSize = 50;
  const filter = { hostId: { $in: hostIds } };
  const [total, users] = await Promise.all([
    RestoredUser.countDocuments(filter),
    RestoredUser.find(filter)
      .select("hostId discordUserId username status lastUpdated email")
      .sort({ hostId: 1, username: 1 })
      .skip((requestedPage - 1) * pageSize)
      .limit(pageSize)
      .lean(),
  ]);

  return response.json({
    users: users.map((user) => ({
      _id: user._id,
      hostId: user.hostId,
      discordUserId: user.discordUserId,
      username: user.username,
      status: user.status,
      lastUpdated: user.lastUpdated,
      hasEmail: Boolean(user.email),
    })),
    total,
    page: requestedPage,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  });
});

userRoutes.post("/", async (request, response) => {
  const hostId = String(request.body?.hostId ?? "");
  const discordUserId = String(request.body?.discordUserId ?? "").trim();
  const username = String(request.body?.username ?? "").trim();
  const accessToken = String(request.body?.accessToken ?? "").trim();
  const refreshToken = String(request.body?.refreshToken ?? "").trim();
  const email = String(request.body?.email ?? "").trim();
  const lastUpdated = request.body?.lastUpdated ? new Date(request.body.lastUpdated) : new Date();

  if (!mongoose.isValidObjectId(hostId) || !(await BotHost.exists({ _id: hostId }))) {
    return response.status(400).json({ error: "호기를 확인해 주세요." });
  }
  if (!/^\d{1,30}$/.test(discordUserId) || !username || username.length > 120) {
    return response.status(400).json({ error: "Discord 유저 ID와 이름을 확인해 주세요." });
  }
  if (!accessToken || accessToken.length > 8192 || !refreshToken || refreshToken.length > 8192) {
    return response.status(400).json({ error: "OAuth access/refresh token을 확인해 주세요." });
  }
  if (email.length > 320 || Number.isNaN(lastUpdated.getTime())) {
    return response.status(400).json({ error: "이메일 또는 갱신 시각을 확인해 주세요." });
  }

  const user = await RestoredUser.create({
    hostId,
    discordUserId,
    username,
    accessToken,
    refreshToken,
    email: email || undefined,
    status: "ACTIVE",
    lastUpdated,
  });

  return response.status(201).json({
    user: {
      _id: user._id,
      hostId: user.hostId,
      discordUserId: user.discordUserId,
      username: user.username,
      status: user.status,
      lastUpdated: user.lastUpdated,
      hasEmail: Boolean(user.email),
    },
  });
});

userRoutes.delete("/:userId", async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.userId)) {
    return response.status(400).json({ error: "유저 데이터 ID가 올바르지 않습니다." });
  }

  const result = await RestoredUser.deleteOne({ _id: request.params.userId });
  if (!result.deletedCount) return response.status(404).json({ error: "유저 데이터를 찾을 수 없습니다." });
  return response.status(204).end();
});
