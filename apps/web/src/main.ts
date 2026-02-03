import { createApp } from "vue";
import { createPinia } from "pinia";
import { createVuetify } from "vuetify";
import { IonicVue } from "@ionic/vue";
import App from "./App.vue";
import { router } from "./router";
import { useAuthStore } from "./stores/auth";

import "vuetify/styles";

const app = createApp(App);
const pinia = createPinia();

app.use(IonicVue);
app.use(pinia);
app.use(router);
app.use(createVuetify());

const authStore = useAuthStore();
authStore.init();

router.isReady().then(() => {
  app.mount("#app");
});
