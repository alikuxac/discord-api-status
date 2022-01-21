import { Schema, Document, model } from "mongoose";

interface Iincident extends Document {
    incidentID: string;
    lastUpdate: string;
    messageID: string;
    resolved: boolean;
}

const incidentSchema = new Schema({
    incidentID: { type: String, required: true },
    lastUpdate: { type: String, required: true },
    messageID: { type: String, required: true },
    resolved: { type: Boolean, required: true },
}, {
    versionKey: false
});

export default model<Iincident>("incident", incidentSchema);