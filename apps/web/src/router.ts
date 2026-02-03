import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import AuthView from "./views/AuthView.vue";
import DashboardView from "./views/DashboardView.vue";
import ClientWorkspaceView from "./views/ClientWorkspaceView.vue";
import SettingsView from "./views/SettingsView.vue";
import { useAuthStore } from "./stores/auth";

export const routes: RouteRecordRaw[] = [
  { path: "/", name: "auth", component: AuthView },
  { path: "/dashboard", name: "dashboard", component: DashboardView, meta: { requiresAuth: true } },
  {
    path: "/clients/:clientId",
    name: "client",
    component: ClientWorkspaceView,
    meta: { requiresAuth: true, requiresClient: true },
  },
  { path: "/settings", name: "settings", component: SettingsView, meta: { requiresAuth: true } },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.requiresAuth && auth.initialized && !auth.currentUser) {
    return { path: "/" };
  }
  if (to.meta.requiresClient && !to.params.clientId) {
    return { path: "/dashboard" };
  }
  return true;
});
