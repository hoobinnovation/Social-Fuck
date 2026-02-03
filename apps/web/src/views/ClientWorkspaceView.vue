<template>
  <ion-page>
    <ion-content class="ion-padding">
      <v-container fluid>
        <v-row align="center" justify="space-between">
          <div>
            <h1>Client Workspace</h1>
            <p>Client ID: {{ clientId }}</p>
          </div>
          <v-btn variant="text" @click="goBack">Back to Dashboard</v-btn>
        </v-row>

        <v-tabs v-model="tab" color="primary" class="mt-4">
          <v-tab value="connections">Connections</v-tab>
          <v-tab value="assets">Assets</v-tab>
          <v-tab value="studio">Content Studio</v-tab>
          <v-tab value="approvals">Approvals</v-tab>
          <v-tab value="calendar">Calendar</v-tab>
          <v-tab value="logs">Logs</v-tab>
        </v-tabs>

        <v-window v-model="tab" class="mt-4">
          <v-window-item value="connections">
            <v-row>
              <v-col v-for="platform in platforms" :key="platform.id" cols="12" md="3">
                <v-card>
                  <v-card-title>{{ platform.label }}</v-card-title>
                  <v-card-text>
                    <div>Status: {{ getConnection(platform.id)?.status ?? "disconnected" }}</div>
                    <div v-if="getConnection(platform.id)?.displayName">
                      {{ getConnection(platform.id)?.displayName }}
                    </div>
                  </v-card-text>
                  <v-card-actions>
                    <v-btn
                      color="primary"
                      :loading="connectionsStore.loading"
                      @click="handleConnect(platform.id)"
                    >
                      Connect
                    </v-btn>
                    <v-btn variant="text" @click="handleDisconnect(platform.id)">Disconnect</v-btn>
                  </v-card-actions>
                </v-card>
              </v-col>
            </v-row>
          </v-window-item>

          <v-window-item value="assets">
            <v-card>
              <v-card-title>Assets</v-card-title>
              <v-card-text>
                <v-file-input v-model="uploadFile" label="Select file" :multiple="false" />
                <v-btn color="primary" :loading="assetsStore.loading" @click="uploadAsset">
                  Upload
                </v-btn>
                <v-divider class="my-4" />
                <v-alert v-if="assetsStore.assets.length === 0" type="info" variant="tonal">
                  No assets yet.
                </v-alert>
                <v-list v-else>
                  <v-list-item v-for="asset in assetsStore.assets" :key="asset.id">
                    <v-list-item-title>{{ asset.originalName }}</v-list-item-title>
                    <v-list-item-subtitle>{{ asset.type }} • {{ asset.size }} bytes</v-list-item-subtitle>
                    <template #append>
                      <v-btn icon="mdi-delete" variant="text" @click="softDelete(asset.id)" />
                    </template>
                  </v-list-item>
                </v-list>
              </v-card-text>
            </v-card>
          </v-window-item>

          <v-window-item value="studio">
            <v-card>
              <v-card-title>Create Post</v-card-title>
              <v-card-text>
                <v-form @submit.prevent="createDraft">
                  <v-text-field v-model="postTitle" label="Post Title" required />
                  <v-row>
                    <v-col cols="12" md="3" v-for="platform in postPlatforms" :key="platform">
                      <v-checkbox v-model="selectedPlatforms" :label="platform" :value="platform" />
                    </v-col>
                  </v-row>
                  <v-divider class="my-4" />
                  <div v-for="platform in selectedPlatforms" :key="platform" class="mb-4">
                    <h4>{{ platform }} Variant</h4>
                    <v-textarea v-model="variantTexts[platform]" label="Caption/Text" />
                    <v-select
                      v-model="variantAssets[platform]"
                      :items="assetOptions"
                      label="Assets"
                      multiple
                    />
                  </div>
                  <v-btn color="primary" :loading="postsStore.loading" @click="createDraft">
                    Save Draft
                  </v-btn>
                </v-form>
              </v-card-text>
            </v-card>

            <v-card class="mt-4">
              <v-card-title>Drafts</v-card-title>
              <v-card-text>
                <v-alert v-if="postsStore.posts.length === 0" type="info" variant="tonal">
                  No posts yet.
                </v-alert>
                <v-list v-else>
                  <v-list-item v-for="post in postsStore.posts" :key="post.id">
                    <v-list-item-title>{{ post.title }}</v-list-item-title>
                    <v-list-item-subtitle>{{ post.status }}</v-list-item-subtitle>
                    <template #append>
                      <v-btn
                        v-if="post.status === 'draft'"
                        color="primary"
                        variant="text"
                        @click="submitPost(post.id)"
                      >
                        Submit for Review
                      </v-btn>
                    </template>
                  </v-list-item>
                </v-list>
              </v-card-text>
            </v-card>
          </v-window-item>

          <v-window-item value="approvals">
            <v-card>
              <v-card-title>Approvals</v-card-title>
              <v-card-text>
                <v-alert v-if="postsStore.reviewQueue.length === 0" type="info" variant="tonal">
                  No posts in review.
                </v-alert>
                <v-list v-else>
                  <v-list-item v-for="post in postsStore.reviewQueue" :key="post.id">
                    <v-list-item-title>{{ post.title }}</v-list-item-title>
                    <v-list-item-subtitle>{{ post.status }}</v-list-item-subtitle>
                    <template #append>
                      <v-btn color="success" variant="text" @click="approve(post.id)">Approve</v-btn>
                      <v-btn color="error" variant="text" @click="reject(post.id)">Reject</v-btn>
                    </template>
                  </v-list-item>
                </v-list>
              </v-card-text>
            </v-card>
          </v-window-item>

          <v-window-item value="calendar">
            <v-card>
              <v-card-title>Schedule</v-card-title>
              <v-card-text>
                <v-form @submit.prevent="scheduleSelected">
                  <v-select
                    v-model="schedulePostId"
                    :items="postOptions"
                    label="Select Post"
                    required
                  />
                  <v-text-field
                    v-model="scheduleDate"
                    label="Publish At"
                    type="datetime-local"
                    required
                  />
                  <v-btn color="primary" @click="scheduleSelected">Schedule</v-btn>
                </v-form>
              </v-card-text>
            </v-card>
          </v-window-item>

          <v-window-item value="logs">
            <v-card>
              <v-card-title>Logs</v-card-title>
              <v-card-text>
                <v-alert v-if="logsStore.logs.length === 0" type="info" variant="tonal">
                  No logs yet.
                </v-alert>
                <v-list v-else>
                  <v-list-item v-for="log in logsStore.logs" :key="log.id">
                    <v-list-item-title>{{ log.platform }} - {{ log.status }}</v-list-item-title>
                    <v-list-item-subtitle>{{ log.errorMessage }}</v-list-item-subtitle>
                  </v-list-item>
                </v-list>
              </v-card-text>
            </v-card>
          </v-window-item>
        </v-window>
      </v-container>

      <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="4000">
        {{ snackbar.message }}
      </v-snackbar>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { IonContent, IonPage } from "@ionic/vue";
import { useAuthStore } from "../stores/auth";
import { useAssetsStore } from "../stores/assets";
import { useConnectionsStore } from "../stores/connections";
import { useLogsStore } from "../stores/logs";
import { usePostsStore } from "../stores/posts";
import type { Connection, Variant } from "../types/models";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const assetsStore = useAssetsStore();
const connectionsStore = useConnectionsStore();
const postsStore = usePostsStore();
const logsStore = useLogsStore();

const tab = ref("connections");
const uploadFile = ref<File | File[] | null>(null);
const postTitle = ref("");
const selectedPlatforms = ref<Variant["platform"][]>([]);
const variantTexts = reactive<Record<string, string>>({});
const variantAssets = reactive<Record<string, string[]>>({});
const schedulePostId = ref("");
const scheduleDate = ref("");
const snackbar = ref({ show: false, message: "", color: "success" });

const clientId = computed(() => route.params.clientId as string);

const platforms = [
  { id: "meta", label: "Meta (FB/IG)" },
  { id: "youtube", label: "YouTube" },
  { id: "tiktok", label: "TikTok" },
  { id: "drive", label: "Google Drive" },
];

const postPlatforms: Variant["platform"][] = ["facebook", "instagram", "youtube", "tiktok"];

const assetOptions = computed(() =>
  assetsStore.assets.map((asset) => ({ title: asset.originalName, value: asset.id })),
);

const postOptions = computed(() =>
  postsStore.posts.map((post) => ({ title: post.title, value: post.id })),
);

const getConnection = (platform: Connection["platform"]) =>
  connectionsStore.connections.find((conn) => conn.platform === platform);

onMounted(() => {
  if (!auth.agencyId || !clientId.value) return;
  assetsStore.startListening(auth.agencyId, clientId.value);
  connectionsStore.startListening(auth.agencyId, clientId.value);
  postsStore.startListening(auth.agencyId, clientId.value);
  postsStore.startReviewQueue(auth.agencyId, clientId.value);
  logsStore.startListening(auth.agencyId, clientId.value);
});

const uploadAsset = async () => {
  if (!auth.agencyId || !clientId.value || !uploadFile.value) return;
  const file = Array.isArray(uploadFile.value) ? uploadFile.value[0] : uploadFile.value;
  if (!file) return;
  try {
    await assetsStore.upload(auth.agencyId, clientId.value, file);
    uploadFile.value = null;
  } catch (error) {
    snackbar.value = { show: true, message: String(error), color: "error" };
  }
};

const softDelete = async (assetId: string) => {
  if (!auth.agencyId || !clientId.value) return;
  await assetsStore.softDelete(auth.agencyId, clientId.value, assetId);
};

const handleConnect = async (platform: Connection["platform"]) => {
  if (!auth.agencyId || !clientId.value) return;
  try {
    await connectionsStore.connect(auth.agencyId, clientId.value, platform);
  } catch (error) {
    snackbar.value = { show: true, message: String(error), color: "error" };
  }
};

const handleDisconnect = async (platform: Connection["platform"]) => {
  if (!auth.agencyId || !clientId.value) return;
  await connectionsStore.disconnect(auth.agencyId, clientId.value, platform);
};

const createDraft = async () => {
  if (!auth.agencyId || !clientId.value || !auth.currentUser) return;
  const variants = selectedPlatforms.value.map((platform) => ({
    platform,
    text: variantTexts[platform] ?? "",
    assetRefs: variantAssets[platform] ?? [],
    settings: {},
  }));
  try {
    await postsStore.createDraft(auth.agencyId, clientId.value, {
      title: postTitle.value,
      createdBy: auth.currentUser.uid,
      variants,
    });
    postTitle.value = "";
    selectedPlatforms.value = [];
  } catch (error) {
    snackbar.value = { show: true, message: String(error), color: "error" };
  }
};

const submitPost = async (postId: string) => {
  if (!auth.agencyId || !clientId.value) return;
  try {
    await postsStore.submit(auth.agencyId, clientId.value, postId);
  } catch (error) {
    snackbar.value = { show: true, message: String(error), color: "error" };
  }
};

const approve = async (postId: string) => {
  if (!auth.agencyId || !clientId.value) return;
  try {
    await postsStore.approve(auth.agencyId, clientId.value, postId, "approved", "Approved");
  } catch (error) {
    snackbar.value = { show: true, message: String(error), color: "error" };
  }
};

const reject = async (postId: string) => {
  if (!auth.agencyId || !clientId.value) return;
  try {
    await postsStore.approve(auth.agencyId, clientId.value, postId, "rejected", "Rejected");
  } catch (error) {
    snackbar.value = { show: true, message: String(error), color: "error" };
  }
};

const scheduleSelected = async () => {
  if (!auth.agencyId || !clientId.value || !schedulePostId.value || !scheduleDate.value) return;
  try {
    await postsStore.schedule(
      auth.agencyId,
      clientId.value,
      schedulePostId.value,
      new Date(scheduleDate.value),
      "Africa/Cairo",
    );
    schedulePostId.value = "";
    scheduleDate.value = "";
  } catch (error) {
    snackbar.value = { show: true, message: String(error), color: "error" };
  }
};

const goBack = () => {
  router.push("/dashboard");
};
</script>
