import { Router } from "express";
import {
  changeMyPinController,
  getMyCoffeeController,
  updateMyCoffeeController,
} from "../../controllers/admin/coffee-admin/coffee.controller.js";
import {
  createMyCategoryController,
  deleteMyCategoryController,
  listMyCategoriesController,
  updateMyCategoryController,
} from "../../controllers/admin/coffee-admin/category.controller.js";
import {
  createMyItemController,
  deleteMyItemController,
  listMyCategoryItemsController,
  updateMyItemController,
} from "../../controllers/admin/coffee-admin/item.controller.js";
import {
  archiveMyOfferController,
  createMyOfferController,
  listMyOffersController,
  updateMyOfferController,
} from "../../controllers/admin/offer.controller.js";
import { requireAdmin, requireCoffeeAdmin } from "../../middlewares/auth.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import {
  categoryIdParamsSchema,
  changePinBodySchema,
  categoryBodySchema,
  insightsQuerySchema,
  itemBodySchema,
  itemIdParamsSchema,
  offerBodySchema,
  offerIdParamsSchema,
  updateOfferBodySchema,
  updateMyCoffeeBodySchema,
  updateItemBodySchema,
  listServiceShiftsQuerySchema,
  listTableSessionsQuerySchema,
  openServiceShiftBodySchema,
  serviceShiftIdParamsSchema,
  tableSessionIdParamsSchema,
  tableNumberParamsSchema,
} from "../../validators/admin.validators.js";
import {
  listMyOrdersController,
  getMyOrderController,
  updateMyOrderStatusController,
  markMyOrderPaidController,
} from "../../controllers/admin/coffee-admin/order.controller.js";
import { getMyCoffeeInsightsController } from "../../controllers/admin/insights.controller.js";
import {
  closeShiftController,
  closeCurrentShiftController,
  getCurrentShiftController,
  getShiftController,
  getTableSessionController,
  closeTableSessionController,
  listShiftsController,
  listTableSessionsController,
  openShiftController,
} from "../../controllers/admin/coffee-admin/service-shift.controller.js";
import { closeTableController, listTablesController } from "../../controllers/admin/coffee-admin/table.controller.js";
import {
  orderIdParamsSchema,
  orderStatusBodySchema,
  listOrdersQuerySchema,
} from "../../validators/order.validators.js";

/**
 * Coffee-admin endpoints. Mounted at /my-coffee; the owning coffee comes from
 * the token, NOT from any request input — so these routes can only ever touch
 * the admin's own coffee, categories and items.
 */
export const coffeeAdminRouter = Router();

coffeeAdminRouter.use(requireAdmin, requireCoffeeAdmin);

coffeeAdminRouter.get("/orders", validate({ query: listOrdersQuerySchema }), listMyOrdersController);
coffeeAdminRouter.get("/insights", validate({ query: insightsQuerySchema }), getMyCoffeeInsightsController);
coffeeAdminRouter.get("/orders/:orderId", validate({ params: orderIdParamsSchema }), getMyOrderController);
coffeeAdminRouter.patch(
  "/orders/:orderId/status",
  validate({ params: orderIdParamsSchema, body: orderStatusBodySchema }),
  updateMyOrderStatusController,
);
coffeeAdminRouter.patch(
  "/orders/:orderId/payment",
  validate({ params: orderIdParamsSchema }),
  markMyOrderPaidController,
);

// Service shifts and table-session operational views.
coffeeAdminRouter.get("/shifts/current", getCurrentShiftController);
coffeeAdminRouter.post("/shifts/open", validate({ body: openServiceShiftBodySchema }), openShiftController);
coffeeAdminRouter.post("/shifts/close", closeCurrentShiftController);
coffeeAdminRouter.get("/shifts", validate({ query: listServiceShiftsQuerySchema }), listShiftsController);
coffeeAdminRouter.get("/shifts/:shiftId/summary", validate({ params: serviceShiftIdParamsSchema }), getShiftController);
coffeeAdminRouter.get("/shifts/:shiftId", validate({ params: serviceShiftIdParamsSchema }), getShiftController);
coffeeAdminRouter.post(
  "/shifts/:shiftId/close",
  validate({ params: serviceShiftIdParamsSchema }),
  closeShiftController,
);
coffeeAdminRouter.patch(
  "/shifts/:shiftId/close",
  validate({ params: serviceShiftIdParamsSchema }),
  closeShiftController,
);
coffeeAdminRouter.get(
  "/shifts/:shiftId/table-sessions",
  validate({ params: serviceShiftIdParamsSchema }),
  listTableSessionsController,
);
coffeeAdminRouter.get(
  "/table-sessions",
  validate({ query: listTableSessionsQuerySchema }),
  listTableSessionsController,
);
coffeeAdminRouter.get(
  "/table-sessions/:sessionId",
  validate({ params: tableSessionIdParamsSchema }),
  getTableSessionController,
);
coffeeAdminRouter.patch(
  "/table-sessions/:sessionId/close",
  validate({ params: tableSessionIdParamsSchema }),
  closeTableSessionController,
);

// Table-centric operational view: the backoffice settles tables, whatever
// the number of client sessions running on them.
coffeeAdminRouter.get("/tables", listTablesController);
coffeeAdminRouter.post(
  "/tables/:tableNumber/close",
  validate({ params: tableNumberParamsSchema }),
  closeTableController,
);

// Explicit resource-name aliases for clients that prefer `/service-shifts`.
coffeeAdminRouter.get("/service-shifts/current", getCurrentShiftController);
coffeeAdminRouter.post("/service-shifts/open", validate({ body: openServiceShiftBodySchema }), openShiftController);
coffeeAdminRouter.post("/service-shifts/close", closeCurrentShiftController);
coffeeAdminRouter.get("/service-shifts", validate({ query: listServiceShiftsQuerySchema }), listShiftsController);
coffeeAdminRouter.get(
  "/service-shifts/:shiftId/summary",
  validate({ params: serviceShiftIdParamsSchema }),
  getShiftController,
);
coffeeAdminRouter.get("/service-shifts/:shiftId", validate({ params: serviceShiftIdParamsSchema }), getShiftController);
coffeeAdminRouter.post(
  "/service-shifts/:shiftId/close",
  validate({ params: serviceShiftIdParamsSchema }),
  closeShiftController,
);
coffeeAdminRouter.patch(
  "/service-shifts/:shiftId/close",
  validate({ params: serviceShiftIdParamsSchema }),
  closeShiftController,
);
coffeeAdminRouter.get(
  "/service-shifts/:shiftId/table-sessions",
  validate({ params: serviceShiftIdParamsSchema }),
  listTableSessionsController,
);

// Coffee information + PIN change.
coffeeAdminRouter.get("/", getMyCoffeeController);
coffeeAdminRouter.patch("/", validate({ body: updateMyCoffeeBodySchema }), updateMyCoffeeController);
coffeeAdminRouter.patch("/pin", validate({ body: changePinBodySchema }), changeMyPinController);

// Categories.
coffeeAdminRouter.get("/categories", listMyCategoriesController);
coffeeAdminRouter.post("/categories", validate({ body: categoryBodySchema }), createMyCategoryController);
coffeeAdminRouter.patch(
  "/categories/:categoryId",
  validate({ params: categoryIdParamsSchema, body: categoryBodySchema }),
  updateMyCategoryController,
);
coffeeAdminRouter.delete(
  "/categories/:categoryId",
  validate({ params: categoryIdParamsSchema }),
  deleteMyCategoryController,
);

// Items (scoped to the admin's own categories).
coffeeAdminRouter.get(
  "/categories/:categoryId/items",
  validate({ params: categoryIdParamsSchema }),
  listMyCategoryItemsController,
);
coffeeAdminRouter.post(
  "/categories/:categoryId/items",
  validate({ params: categoryIdParamsSchema, body: itemBodySchema }),
  createMyItemController,
);
coffeeAdminRouter.patch(
  "/items/:itemId",
  validate({ params: itemIdParamsSchema, body: updateItemBodySchema }),
  updateMyItemController,
);
coffeeAdminRouter.delete("/items/:itemId", validate({ params: itemIdParamsSchema }), deleteMyItemController);

// Daily offers (always scoped to the admin's own coffee).
coffeeAdminRouter.get("/offers", listMyOffersController);
coffeeAdminRouter.post("/offers", validate({ body: offerBodySchema }), createMyOfferController);
coffeeAdminRouter.patch(
  "/offers/:offerId",
  validate({ params: offerIdParamsSchema, body: updateOfferBodySchema }),
  updateMyOfferController,
);
coffeeAdminRouter.delete("/offers/:offerId", validate({ params: offerIdParamsSchema }), archiveMyOfferController);
