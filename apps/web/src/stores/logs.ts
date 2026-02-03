import { defineStore } from "pinia";
import type { LogEntry } from "../types/models";
import { listenLogs } from "../services/logs.service";

interface LogsState {
  logs: LogEntry[];
  unsubscribe?: () => void;
}

export const useLogsStore = defineStore("logs", {
  state: (): LogsState => ({
    logs: [],
    unsubscribe: undefined,
  }),
  actions: {
    startListening(agencyId: string, clientId: string) {
      if (this.unsubscribe) this.unsubscribe();
      this.unsubscribe = listenLogs(agencyId, clientId, (logs) => {
        this.logs = logs;
      });
    },
  },
});
