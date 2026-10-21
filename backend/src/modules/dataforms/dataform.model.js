import mongoose from 'mongoose';
import { TYPE_NAMES } from './fieldTypes.js';

const dataformSchema = new mongoose.Schema(
  {
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true },
    description: { type: String, default: '', maxlength: 500 },
    category: { type: String, default: '', trim: true, maxlength: 60 },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    // Key of the field used as the record's display label (relationship pickers, titles).
    primaryField: { type: String, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
dataformSchema.index({ account: 1, workspace: 1, slug: 1 }, { unique: true });

// Field metadata lives in its own collection, separate from record data.
const fieldSchema = new mongoose.Schema(
  {
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    dataform: { type: mongoose.Schema.Types.ObjectId, ref: 'Dataform', required: true },
    // Immutable. Record values are stored under data.<key>.
    key: { type: String, required: true, match: /^[a-z][a-z0-9_]{0,39}$/ },
    label: { type: String, required: true, trim: true, maxlength: 80 },
    type: { type: String, required: true, enum: TYPE_NAMES },
    description: { type: String, default: '', maxlength: 300 },
    section: { type: String, default: 'General', trim: true, maxlength: 60 },
    order: { type: Number, default: 0 },
    required: { type: Boolean, default: false },
    unique: { type: Boolean, default: false },
    readOnly: { type: Boolean, default: false },
    defaultValue: { type: mongoose.Schema.Types.Mixed, default: null },
    min: { type: Number, default: null },
    max: { type: Number, default: null },
    options: {
      type: [{ _id: false, value: { type: String, maxlength: 80 }, label: { type: String, maxlength: 80 } }],
      default: [],
    },
    config: { targetDataform: { type: mongoose.Schema.Types.ObjectId, ref: 'Dataform', default: null } },
    visibility: {
      create: { type: Boolean, default: true },
      edit: { type: Boolean, default: true },
      list: { type: Boolean, default: true },
    },
  },
  { timestamps: true },
);
fieldSchema.index({ dataform: 1, key: 1 }, { unique: true });
fieldSchema.index({ dataform: 1, order: 1 });
fieldSchema.index({ account: 1, 'config.targetDataform': 1 }, { sparse: true });

export const Dataform = mongoose.model('Dataform', dataformSchema);
export const FieldDefinition = mongoose.model('FieldDefinition', fieldSchema);
