import mongoose from 'mongoose';

const reportSchema = new mongoose.Schema(
  {
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    dataform: { type: mongoose.Schema.Types.ObjectId, ref: 'Dataform', required: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 500 },
    // 'list': columns + filter + sort. 'analyzer': saved Grouped Table Analyzer configuration.
    kind: { type: String, enum: ['list', 'analyzer'], required: true },
    shared: { type: Boolean, default: false },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);
reportSchema.index({ account: 1, workspace: 1, shared: 1 });
reportSchema.index({ account: 1, owner: 1 });

const dashboardSchema = new mongoose.Schema(
  {
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // 'account' dashboards are visible to every member; 'user' dashboards only to their owner.
    scope: { type: String, enum: ['account', 'user'], required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    // Order in the array is display order. Bounded to 30 widgets by validation.
    widgets: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { timestamps: true },
);
dashboardSchema.index({ account: 1, scope: 1 });
dashboardSchema.index({ account: 1, owner: 1 });

export const Report = mongoose.model('Report', reportSchema);
export const Dashboard = mongoose.model('Dashboard', dashboardSchema);
