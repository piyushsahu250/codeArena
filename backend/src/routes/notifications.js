const express = require("express");
const prisma = require("../prisma");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

// Every authenticated role (STUDENT/STAFF/ADMIN) reads only their own notifications — this is the
// endpoint that closes the "no backend notification source for staff/admin" gap Navbar.jsx
// documents. `?unreadOnly=true` powers the bell dropdown; the full paginated list is for a future
// dedicated notifications page.
router.get("/", authenticate, async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 10));
  const where = { recipientId: req.user.id, ...(req.query.unreadOnly === "true" ? { read: false } : {}) };
  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.notification.count({ where }),
  ]);
  res.json({ notifications, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
});

router.get("/unread-count", authenticate, async (req, res) => {
  const count = await prisma.notification.count({ where: { recipientId: req.user.id, read: false } });
  res.json({ count });
});

router.patch("/:id/read", authenticate, async (req, res) => {
  const existing = await prisma.notification.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.recipientId !== req.user.id) return res.status(404).json({ error: "Notification not found" });
  const updated = await prisma.notification.update({ where: { id: req.params.id }, data: { read: true, readAt: new Date() } });
  res.json(updated);
});

router.post("/mark-all-read", authenticate, async (req, res) => {
  await prisma.notification.updateMany({
    where: { recipientId: req.user.id, read: false },
    data: { read: true, readAt: new Date() },
  });
  res.json({ success: true });
});

module.exports = router;
