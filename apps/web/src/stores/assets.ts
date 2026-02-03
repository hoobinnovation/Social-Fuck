import { defineStore } from "pinia";
import type { Asset } from "../types/models";
import { hardDeleteAsset, listenAssets, softDeleteAsset, uploadAsset } from "../services/assets.service";

interface AssetsState {
  assets: Asset[];
  loading: boolean;
  error: string;
  unsubscribe?: () => void;
}

export const useAssetsStore = defineStore("assets", {
  state: (): AssetsState => ({
    assets: [],
    loading: false,
    error: "",
    unsubscribe: undefined,
  }),
  actions: {
    startListening(agencyId: string, clientId: string) {
      if (this.unsubscribe) this.unsubscribe();
      this.unsubscribe = listenAssets(agencyId, clientId, (assets) => {
        this.assets = assets;
      });
    },
    async upload(agencyId: string, clientId: string, file: File) {
      this.loading = true;
      this.error = "";
      try {
        await uploadAsset(agencyId, clientId, file);
      } catch (error) {
        this.error = String(error);
        throw error;
      } finally {
        this.loading = false;
      }
    },
    async softDelete(agencyId: string, clientId: string, assetId: string) {
      await softDeleteAsset(agencyId, clientId, assetId);
    },
    async hardDelete(agencyId: string, clientId: string, asset: Asset) {
      await hardDeleteAsset(agencyId, clientId, asset);
    },
  },
});
