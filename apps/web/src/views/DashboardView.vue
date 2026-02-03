<template>
  <ion-page>
    <ion-content class="ion-padding">
      <v-container fluid>
        <v-row align="center" justify="space-between">
          <div>
            <h1>Agency Dashboard</h1>
            <p v-if="auth.agencyId">Agency ID: {{ auth.agencyId }}</p>
          </div>
          <div class="d-flex ga-2">
            <v-btn color="primary" @click="openDialog">Add Client</v-btn>
            <v-btn variant="text" @click="handleLogout">Logout</v-btn>
          </div>
        </v-row>

        <v-row class="mt-4">
          <v-col cols="12" md="8">
            <v-card>
              <v-card-title>Clients</v-card-title>
              <v-card-text>
                <v-alert v-if="clientsStore.clients.length === 0" type="info" variant="tonal">
                  No clients yet. Add your first client.
                </v-alert>
                <v-list v-else>
                  <v-list-item
                    v-for="client in clientsStore.clients"
                    :key="client.id"
                    @click="goToClient(client.id)"
                  >
                    <v-list-item-title>{{ client.name }}</v-list-item-title>
                    <v-list-item-subtitle>{{ client.timezone }} • {{ client.status }}</v-list-item-subtitle>
                    <template #append>
                      <v-btn icon="mdi-pencil" variant="text" @click.stop="editClient(client)" />
                      <v-btn icon="mdi-archive" variant="text" @click.stop="archive(client.id)" />
                    </template>
                  </v-list-item>
                </v-list>
              </v-card-text>
            </v-card>
          </v-col>
          <v-col cols="12" md="4">
            <v-card>
              <v-card-title>Stats</v-card-title>
              <v-card-text>
                <div>Clients: {{ clientsStore.clients.length }}</div>
                <div>Role: {{ auth.role || "viewer" }}</div>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>
      </v-container>

      <v-dialog v-model="dialog" max-width="500">
        <v-card>
          <v-card-title>{{ editingClientId ? "Edit Client" : "Add Client" }}</v-card-title>
          <v-card-text>
            <v-form @submit.prevent="saveClient">
              <v-text-field v-model="clientName" label="Client Name" required />
              <v-text-field v-model="clientTimezone" label="Timezone" required />
            </v-form>
          </v-card-text>
          <v-card-actions>
            <v-btn variant="text" @click="dialog = false">Cancel</v-btn>
            <v-btn color="primary" :loading="clientsStore.loading" @click="saveClient">
              Save
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>

      <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="4000">
        {{ snackbar.message }}
      </v-snackbar>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { IonContent, IonPage } from "@ionic/vue";
import { useAuthStore } from "../stores/auth";
import { useClientsStore } from "../stores/clients";
import type { Client } from "../types/models";

const auth = useAuthStore();
const clientsStore = useClientsStore();
const router = useRouter();

const dialog = ref(false);
const clientName = ref("");
const clientTimezone = ref("Africa/Cairo");
const editingClientId = ref("");
const snackbar = ref({ show: false, message: "", color: "success" });

onMounted(() => {
  if (auth.agencyId) {
    clientsStore.startListening(auth.agencyId);
  }
});

const openDialog = () => {
  editingClientId.value = "";
  clientName.value = "";
  clientTimezone.value = "Africa/Cairo";
  dialog.value = true;
};

const editClient = (client: Client) => {
  editingClientId.value = client.id;
  clientName.value = client.name;
  clientTimezone.value = client.timezone;
  dialog.value = true;
};

const saveClient = async () => {
  if (!auth.agencyId) return;
  try {
    if (editingClientId.value) {
      await clientsStore.editClient(auth.agencyId, editingClientId.value, {
        name: clientName.value,
        timezone: clientTimezone.value,
      });
    } else {
      await clientsStore.addClient(auth.agencyId, {
        name: clientName.value,
        timezone: clientTimezone.value,
      });
    }
    dialog.value = false;
  } catch (error) {
    snackbar.value = { show: true, message: String(error), color: "error" };
  }
};

const archive = async (clientId: string) => {
  if (!auth.agencyId) return;
  await clientsStore.archiveClient(auth.agencyId, clientId);
};

const goToClient = (clientId: string) => {
  router.push(`/clients/${clientId}`);
};

const handleLogout = async () => {
  await auth.logout();
  router.push("/");
};
</script>
