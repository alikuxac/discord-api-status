export interface IncientTable {
    ID: string;
    data: DataEntry;
}

export interface DataEntry {
    messageID: string;
    incidentID: string;
    lastUpdate: string;
    resolved: boolean;
}