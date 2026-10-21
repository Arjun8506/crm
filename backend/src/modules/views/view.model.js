import mongoose from 'mongoose';

// A saved way of looking at a dataform: layout type plus its query (search, filter, sort) and display options.
const viewSchema = new mongoose.Schema(
  {
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    dataform: { type: mongoose.Schema.Types.ObjectId, ref: 'Dataform', required: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    type: { type: String, enum: ['table', 'cards', 'kanban', 'calendar', 'map'], required: true },
    // Shared views are visible to everyone who can open the dataform.
    shared: { type: Boolean, default: false },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);
viewSchema.index({ account: 1, dataform: 1, shared: 1 });
viewSchema.index({ account: 1, dataform: 1, owner: 1 });

export const View = mongoose.model('View', viewSchema);
