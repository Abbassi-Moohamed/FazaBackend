import { model, Schema, type InferSchemaType, type Types } from "mongoose";

export const TABLE_SESSION_STATUSES = ["ACTIVE", "CLOSED"] as const;
export type TableSessionStatus = (typeof TABLE_SESSION_STATUSES)[number];

const tableSessionSchema = new Schema(
  {
    coffeeId: { type: Schema.Types.ObjectId, ref: "Coffee", required: true, index: true },
    tableNumber: { type: Number, required: true, min: 1, max: 10000 },
    serviceShiftId: { type: Schema.Types.ObjectId, ref: "ServiceShift", default: null, index: true },
    sessionTokenHash: { type: String, required: true, unique: true, select: false },
    status: { type: String, enum: TABLE_SESSION_STATUSES, required: true, default: "ACTIVE", index: true },
    openedAt: { type: Date, required: true, default: Date.now },
    closedAt: { type: Date, default: null },
    lastOrderAt: { type: Date, required: true, default: Date.now },
    orderCount: { type: Number, required: true, min: 0, default: 0 },
  },
  { timestamps: true, versionKey: false, collection: "table_sessions" },
);

// A table can host several concurrent sessions (different parties sharing a
// table): the session token — not the table number — identifies the customer.
tableSessionSchema.index(
  { coffeeId: 1, tableNumber: 1, status: 1, lastOrderAt: -1 },
  { name: "idx_table_sessions_table_status" },
);
tableSessionSchema.index({ coffeeId: 1, serviceShiftId: 1, createdAt: -1 });
tableSessionSchema.index({ coffeeId: 1, status: 1, lastOrderAt: -1 });

export type TableSession = InferSchemaType<typeof tableSessionSchema> & { _id: Types.ObjectId };
export const TableSessionModel = model<TableSession>("TableSession", tableSessionSchema);
