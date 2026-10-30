export type ApiError={code:string;message:string;requestId:string};
export type User={id:string;email:string;display_name:string;role:'player'|'admin'};
export type Progress={level_id:string;best_score:number;best_time_ms:number;stars:number;version:number};
export type RunTicket={runId:string;ticket:string;expiresAt:string};
export type SyncEvent={id:string;type:'completion';payload:{puzzleId:string;score:number;elapsedMs:number;casual:true}};
