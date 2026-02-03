import { defineStore } from "pinia";
import type { Post, Variant } from "../types/models";
import { approvePost, createPost, listenPosts, listenReviewQueue, schedulePost, submitForReview } from "../services/posts.service";

interface PostsState {
  posts: Post[];
  reviewQueue: Post[];
  loading: boolean;
  error: string;
  unsubscribePosts?: () => void;
  unsubscribeReview?: () => void;
}

export const usePostsStore = defineStore("posts", {
  state: (): PostsState => ({
    posts: [],
    reviewQueue: [],
    loading: false,
    error: "",
    unsubscribePosts: undefined,
    unsubscribeReview: undefined,
  }),
  actions: {
    startListening(agencyId: string, clientId: string) {
      if (this.unsubscribePosts) this.unsubscribePosts();
      this.unsubscribePosts = listenPosts(agencyId, clientId, (posts) => {
        this.posts = posts;
      });
    },
    startReviewQueue(agencyId: string, clientId: string) {
      if (this.unsubscribeReview) this.unsubscribeReview();
      this.unsubscribeReview = listenReviewQueue(agencyId, clientId, (posts) => {
        this.reviewQueue = posts;
      });
    },
    async createDraft(
      agencyId: string,
      clientId: string,
      payload: { title: string; createdBy: string; variants: Omit<Variant, "id">[] },
    ) {
      this.loading = true;
      this.error = "";
      try {
        await createPost(agencyId, clientId, payload);
      } catch (error) {
        this.error = String(error);
        throw error;
      } finally {
        this.loading = false;
      }
    },
    async submit(agencyId: string, clientId: string, postId: string) {
      await submitForReview(agencyId, clientId, postId);
    },
    async approve(
      agencyId: string,
      clientId: string,
      postId: string,
      decision: "approved" | "rejected",
      reason: string,
    ) {
      await approvePost(agencyId, clientId, postId, decision, reason);
    },
    async schedule(
      agencyId: string,
      clientId: string,
      postId: string,
      publishAt: Date,
      timezone: string,
    ) {
      await schedulePost(agencyId, clientId, postId, publishAt, timezone);
    },
  },
});
