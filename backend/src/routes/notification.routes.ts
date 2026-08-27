// /api/notifications — the user's notification inbox. Every route is scoped to
// the authenticated caller; there is no way to read or alter another user's
// notifications (the service always filters by req.auth.id).
import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { ok } from '../lib/respond';
import { markReadSchema, notificationsQuerySchema } from '../validation/notification.schema';
import { listNotifications, markRead, unreadCount } from '../services/notification.service';

export const notificationRouter = Router();

notificationRouter.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = notificationsQuerySchema.parse(req.query);
    return ok(res, await listNotifications(req.auth!.id, q.page, q.pageSize));
  } catch (e) {
    return next(e);
  }
});

notificationRouter.get('/unread-count', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    return ok(res, await unreadCount(req.auth!.id));
  } catch (e) {
    return next(e);
  }
});

notificationRouter.post('/read', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, all } = markReadSchema.parse(req.body);
    // `all` (or no id) marks everything read; an id marks just that row —
    // only if it belongs to the caller.
    return ok(res, await markRead(req.auth!.id, all ? undefined : id), 'Notifications marked as read.');
  } catch (e) {
    return next(e);
  }
});
