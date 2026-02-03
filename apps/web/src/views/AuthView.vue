<template>
  <ion-page>
    <ion-content class="ion-padding">
      <v-container class="fill-height" fluid>
        <v-row align="center" justify="center">
          <v-col cols="12" sm="8" md="5">
            <v-card>
              <v-card-title>AuraSocial Auth</v-card-title>
              <v-card-text>
                <v-tabs v-model="tab" grow>
                  <v-tab value="login">Login</v-tab>
                  <v-tab value="register">Register</v-tab>
                  <v-tab value="reset">Reset</v-tab>
                </v-tabs>
                <v-window v-model="tab" class="mt-4">
                  <v-window-item value="login">
                    <v-form @submit.prevent="handleLogin">
                      <v-text-field v-model="loginEmail" label="Email" type="email" required />
                      <v-text-field v-model="loginPassword" label="Password" type="password" required />
                      <v-btn type="submit" color="primary" :loading="auth.loading" block @click="handleLogin">
                        Login
                      </v-btn>
                    </v-form>
                  </v-window-item>
                  <v-window-item value="register">
                    <v-form @submit.prevent="handleRegister">
                      <v-text-field v-model="registerName" label="Display Name" required />
                      <v-text-field v-model="registerEmail" label="Email" type="email" required />
                      <v-text-field v-model="registerPassword" label="Password" type="password" required />
                      <v-btn type="submit" color="primary" :loading="auth.loading" block @click="handleRegister">
                        Register
                      </v-btn>
                    </v-form>
                  </v-window-item>
                  <v-window-item value="reset">
                    <v-form @submit.prevent="handleReset">
                      <v-text-field v-model="resetEmail" label="Email" type="email" required />
                      <v-btn type="submit" color="primary" block @click="handleReset">
                        Send Reset Link
                      </v-btn>
                    </v-form>
                  </v-window-item>
                </v-window>
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
import { useRouter } from "vue-router";
import { IonContent, IonPage } from "@ionic/vue";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();
const tab = ref("login");

const loginEmail = ref("");
const loginPassword = ref("");
const registerEmail = ref("");
const registerPassword = ref("");
const registerName = ref("");
const resetEmail = ref("");

const snackbar = ref({ show: false, message: "", color: "error" });

const handleLogin = async () => {
  try {
    await auth.login(loginEmail.value, loginPassword.value);
    snackbar.value = { show: true, message: "Logged in successfully", color: "success" };
    router.push("/dashboard");
  } catch (error) {
    snackbar.value = { show: true, message: String(error), color: "error" };
  }
};

const handleRegister = async () => {
  try {
    await auth.register(registerEmail.value, registerPassword.value, registerName.value);
    snackbar.value = { show: true, message: "Account created", color: "success" };
    router.push("/dashboard");
  } catch (error) {
    snackbar.value = { show: true, message: String(error), color: "error" };
  }
};

const handleReset = async () => {
  try {
    await auth.reset(resetEmail.value);
    snackbar.value = { show: true, message: "Password reset email sent", color: "success" };
  } catch (error) {
    snackbar.value = { show: true, message: String(error), color: "error" };
  }
};
</script>
