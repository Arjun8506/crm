import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

// Metadata only. File bytes live in the storage provider under `storageKey`; there is never a public URL.
const attachmentSchema = new mongoose.Schema(
  {
    account: { type: ObjectId, ref: 'Account', required: true },
    workspace: { type: ObjectId, ref: 'Workspace', required: true },
    dataform: { type: ObjectId, ref: 'Dataform', required: true },
    record: { type: ObjectId, ref: 'Record', required: true },
    uploader: { type: ObjectId, ref: 'User', required: true },
    filename: { type: String, required: true, maxlength: 200 },
    mimeType: { type: String, default: 'application/octet-stream', maxlength: 120 },
    size: { type: Number, required: true },
    description: { type: String, default: '', maxlength: 300 },
    // True only when the bytes really are a png/jpeg/gif/webp matching the declared type: safe to render inline.
    previewable: { type: Boolean, default: false },
    storageKey: { type: String, required: true, select: false },
  },
  { timestamps: true },
);
attachmentSchema.index({ account: 1, record: 1, createdAt: -1 });

export const Attachment = mongoose.model('Attachment', attachmentSchema);
