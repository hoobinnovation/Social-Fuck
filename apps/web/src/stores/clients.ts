import { defineStore } from "pinia";
import type { Client } from "../types/models";
import { archiveClient, createClient, listenClients, updateClient } from "../services/clients.service";

interface ClientsState {
  clients: Client[];
  selectedClientId: string;
  loading: boolean;
  error: string;
  unsubscribe?: () => void;
}

export const useClientsStore = defineStore("clients", {
  state: (): ClientsState => ({
    clients: [],
    selectedClientId: "",
    loading: false,
    error: "",
    unsubscribe: undefined,
  }),
  actions: {
    startListening(agencyId: string) {
      if (this.unsubscribe) this.unsubscribe();
      this.unsubscribe = listenClients(agencyId, (clients) => {
        this.clients = clients;
      });
    },
    selectClient(clientId: string) {
      this.selectedClientId = clientId;
    },
    async addClient(agencyId: string, payload: { name: string; timezone: string }) {
      this.loading = true;
      this.error = "";
      try {
        await createClient(agencyId, payload);
      } catch (error) {
        this.error = String(error);
        throw error;
      } finally {
        this.loading = false;
      }
    },
    async editClient(agencyId: string, clientId: string, payload: Partial<Client>) {
      await updateClient(agencyId, clientId, payload);
    },
    async archiveClient(agencyId: string, clientId: string) {
      await archiveClient(agencyId, clientId);
    },
  },
});
