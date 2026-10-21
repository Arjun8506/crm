// One-off data backfills for records created before a feature existed. Safe to run repeatedly.
//   Phase 3: Kanban ordering. Records created before `rank` existed get rank = createdAt (ms).
import mongoose from 'mongoose';
import { RecordModel } from '../src/modules/records/record.model.js';

await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
const res = await RecordModel.collection.updateMany({ rank: { $exists: false } }, [{ $set: { rank: { $toLong: '$createdAt' } } }]);
console.log(`rank backfill: ${res.modifiedCount} record(s) updated`);
await mongoose.disconnect();
