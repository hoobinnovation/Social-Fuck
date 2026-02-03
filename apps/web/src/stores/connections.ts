import { defineStore } from "pinia";
import type { Connection } from "../types/models";
import { disconnectPlatform, listenConnections, startOAuth } from "../services/connections.service";

interface ConnectionsState {
  connections: Connection[];
  loading: boolean;
  error: string;
  unsubscribe?: () => void;
}

export const useConnectionsStore = defineStore("connections", {
  state: (): ConnectionsState => ({
    connections: [],
    loading: false,
    error: "",
    unsubscribe: undefined,
  }),
  actions: {
    startListening(agencyId: string, clientId: string) {
      if (this.unsubscribe) this.unsubscribe();
      this.unsubscribe = listenConnections(agencyId, clientId, (connections) => {
        this.connections = connections;
      });
    },
    async connect(agencyId: string, clientId: string, platform: Connection["platform"]) {
      this.loading = true;
      this.error = "";
      try {
        const authUrl = await startOAuth(agencyId, clientId, platform);
        window.location.href = authUrl;
      } catch (error) {
        this.error = String(error);
        throw error;
      } finally {
        this.loading = false;
      }
    },
    async disconnect(agencyId: string, clientId: string, platform: Connection["platform"]) {
      await disconnectPlatform(agencyId, clientId, platform);
    },
  },
});
