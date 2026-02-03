import { defineStore } from "pinia";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "../services/firebase";
import { getUserProfile, login, logout, register, resetPassword } from "../services/auth.service";
import type { UserRole } from "../types/models";

interface AuthState {
  currentUser: User | null;
  agencyId: string;
  role: UserRole | "";
  loading: boolean;
  error: string;
  initialized: boolean;
}

export const useAuthStore = defineStore("auth", {
  state: (): AuthState => ({
    currentUser: null,
    agencyId: "",
    role: "",
    loading: false,
    error: "",
    initialized: false,
  }),
  actions: {
    init() {
      onAuthStateChanged(auth, async (user) => {
        this.currentUser = user;
        if (user) {
          const profile = await getUserProfile(user.uid);
          this.agencyId = (profile?.agencyId as string) ?? "";
          this.role = (profile?.role as UserRole) ?? "viewer";
        } else {
          this.agencyId = "";
          this.role = "";
        }
        this.initialized = true;
      });
    },
    async login(email: string, password: string) {
      this.loading = true;
      this.error = "";
      try {
        await login(email, password);
      } catch (error) {
        this.error = String(error);
        throw error;
      } finally {
        this.loading = false;
      }
    },
    async register(email: string, password: string, displayName: string) {
      this.loading = true;
      this.error = "";
      try {
        await register(email, password, displayName);
      } catch (error) {
        this.error = String(error);
        throw error;
      } finally {
        this.loading = false;
      }
    },
    async logout() {
      await logout();
    },
    async reset(email: string) {
      await resetPassword(email);
    },
  },
});
