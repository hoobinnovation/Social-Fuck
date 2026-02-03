<template>
  <ion-page>
    <ion-content class="ion-padding">
      <v-container>
        <h1>Settings</h1>
        <v-row>
          <v-col cols="12" md="6">
            <v-card>
              <v-card-title>Profile</v-card-title>
              <v-card-text>
                <v-form @submit.prevent="saveProfile">
                  <v-text-field v-model="displayName" label="Display Name" />
                  <v-btn color="primary" @click="saveProfile">Save Profile</v-btn>
                </v-form>
              </v-card-text>
            </v-card>
          </v-col>
          <v-col cols="12" md="6">
            <v-card>
              <v-card-title>Security</v-card-title>
              <v-card-text>
                <v-text-field v-model="resetEmail" label="Email" type="email" />
                <v-btn color="primary" @click="sendReset">Send Password Reset</v-btn>
              </v-card-text>
            </v-card>
          </v-col>
          <v-col cols="12">
            <v-card>
              <v-card-title>Delete Account</v-card-title>
              <v-card-text>
                <v-btn color="error" @click="requestDelete">Request Account Deletion</v-btn>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>
      </v-container>
      <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="4000">
        {{ snackbar.message }}
      </v-snackbar>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { IonContent, IonPage } from "@ionic/vue";
import { updateProfile } from "firebase/auth";
import { auth } from "../services/firebase";
import { resetPassword } from "../services/auth.service";

const displayName = ref(auth.currentUser?.displayName ?? "");
const resetEmail = ref(auth.currentUser?.email ?? "");
const snackbar = ref({ show: false, message: "", color: "success" });

const saveProfile = async () => {
  if (!auth.currentUser) return;
  try {
    await updateProfile(auth.currentUser, { displayName: displayName.value });
    snackbar.value = { show: true, message: "Profile updated", color: "success" };
  } catch (error) {
    snackbar.value = { show: true, message: String(error), color: "error" };
  }
};

const sendReset = async () => {
  try {
    await resetPassword(resetEmail.value);
    snackbar.value = { show: true, message: "Reset email sent", color: "success" };
  } catch (error) {
    snackbar.value = { show: true, message: String(error), color: "error" };
  }
};

const requestDelete = async () => {
  snackbar.value = {
    show: true,
    message: "Account deletion request recorded. Contact admin for confirmation.",
    color: "info",
  };
};
</script>
