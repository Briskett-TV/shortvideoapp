"use client";

import {
  CSSProperties,
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { auth, db, storage } from "@/lib/firebase";
import { onAuthStateChanged, signInAnonymously, User } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytesResumable,
} from "firebase/storage";

type Tab = "home" | "create" | "profile";
type FeedSection = "all" | "following" | "food" | "gym" | "mixed";
type PostCategory = "food" | "gym";
type Visibility = "public" | "private";
type PostType = "video" | "slideshow";
type ProfileSection = "posts" | "saved" | "liked" | "settings";

type ReplyItem = {
  id: string;
  authorId: string;
  authorUsername: string;
  text: string;
  createdAt: number;
};

type CommentItem = {
  id: string;
  authorId: string;
  authorUsername: string;
  text: string;
  createdAt: number;
  replies: ReplyItem[];
};

type SlideshowSlide = {
  id: string;
  imageUrl: string;
};

type Post = {
  id: string;
  videoUrl: string;
  username: string;
  caption: string;
  likes: number;
  dislikes: number;
  comments: number;
  shares: number;
  views: number;
  createdAt?: number;
  category: PostCategory;
  visibility: Visibility;
  ownerId: string | null;
  postType: PostType;
  storagePath: string;
  likedBy: string[];
  dislikedBy: string[];
  audioName: string;
  recipeText: string;
  workoutSummary: string;
  slideshowSlides: SlideshowSlide[];
  slideshowStoragePaths: string[];
  commentsData: CommentItem[];
  isFoodOrGymRelated: boolean;
};

type UserProfile = {
  username: string;
  bio: string;
  savedPostIds: string[];
  followingIds: string[];
  followerIds: string[];
};

const TOP_NAV_HEIGHT = 58;
const BOTTOM_NAV_HEIGHT = 74;

function getMillis(value: unknown): number | undefined {
  if (value instanceof Timestamp) return value.toMillis();

  if (
    typeof value === "object" &&
    value !== null &&
    "seconds" in value &&
    typeof (value as { seconds?: unknown }).seconds === "number"
  ) {
    return (value as { seconds: number }).seconds * 1000;
  }

  if (typeof value === "number") return value;
  return undefined;
}

function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function safeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function safeSlideshowSlides(value: unknown): SlideshowSlide[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item, index) => {
      if (typeof item === "string") {
        return {
          id: `slide-${index}`,
          imageUrl: item,
        };
      }

      if (typeof item === "object" && item !== null) {
        const slide = item as Partial<SlideshowSlide>;
        return {
          id: typeof slide.id === "string" ? slide.id : `slide-${index}`,
          imageUrl:
            typeof slide.imageUrl === "string" ? slide.imageUrl : "",
        };
      }

      return null;
    })
    .filter((item): item is SlideshowSlide => !!item && !!item.imageUrl);
}

function safeReplies(value: unknown): ReplyItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((reply, index) => {
      const item = reply as Partial<ReplyItem>;
      return {
        id:
          typeof item.id === "string"
            ? item.id
            : `reply-${index}-${Date.now()}`,
        authorId: typeof item.authorId === "string" ? item.authorId : "",
        authorUsername:
          typeof item.authorUsername === "string"
            ? item.authorUsername
            : "@user",
        text: typeof item.text === "string" ? item.text : "",
        createdAt:
          typeof item.createdAt === "number" ? item.createdAt : Date.now(),
      };
    })
    .filter((reply) => reply.text.trim() !== "");
}

function safeComments(value: unknown): CommentItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((comment, index) => {
      const item = comment as Partial<CommentItem> & { replies?: unknown };
      return {
        id:
          typeof item.id === "string"
            ? item.id
            : `comment-${index}-${Date.now()}`,
        authorId: typeof item.authorId === "string" ? item.authorId : "",
        authorUsername:
          typeof item.authorUsername === "string"
            ? item.authorUsername
            : "@user",
        text: typeof item.text === "string" ? item.text : "",
        createdAt:
          typeof item.createdAt === "number" ? item.createdAt : Date.now(),
        replies: safeReplies(item.replies),
      };
    })
    .filter((comment) => comment.text.trim() !== "");
}

function mapPost(docItem: { id: string; data: () => any }): Post {
  const data = docItem.data();
  const likedBy = safeStringArray(data.likedBy);
  const dislikedBy = safeStringArray(data.dislikedBy);
  const commentsData = safeComments(data.commentsData);

  return {
    id: docItem.id,
    videoUrl:
      typeof data.videoUrl === "string"
        ? data.videoUrl
        : typeof data.url === "string"
          ? data.url
          : "",
    username:
      typeof data.username === "string" && data.username.trim() !== ""
        ? data.username
        : "@user",
    caption: safeString(data.caption),
    likes:
      typeof data.likesCount === "number" ? data.likesCount : likedBy.length,
    dislikes:
      typeof data.dislikesCount === "number"
        ? data.dislikesCount
        : dislikedBy.length,
    comments:
      typeof data.commentsCount === "number"
        ? data.commentsCount
        : commentsData.reduce(
            (sum, comment) => sum + 1 + comment.replies.length,
            0
          ),
    shares: typeof data.sharesCount === "number" ? data.sharesCount : 0,
    views: typeof data.viewsCount === "number" ? data.viewsCount : 0,
    createdAt: getMillis(data.createdAt),
    category: data.category === "gym" ? "gym" : "food",
    visibility: data.visibility === "private" ? "private" : "public",
    ownerId:
      typeof data.ownerId === "string"
        ? data.ownerId
        : typeof data.userId === "string"
          ? data.userId
          : null,
    postType: data.postType === "slideshow" ? "slideshow" : "video",
    storagePath: safeString(data.storagePath),
    likedBy,
    dislikedBy,
    audioName: safeString(data.audioName),
    recipeText: safeString(data.recipeText),
    workoutSummary: safeString(data.workoutSummary),
    slideshowSlides: safeSlideshowSlides(data.slideshowSlides),
    slideshowStoragePaths: safeStringArray(data.slideshowStoragePaths),
    commentsData,
    isFoodOrGymRelated:
      typeof data.isFoodOrGymRelated === "boolean"
        ? data.isFoodOrGymRelated
        : true,
  };
}

function interleavePosts(foodPosts: Post[], gymPosts: Post[]) {
  const result: Post[] = [];
  const maxLength = Math.max(foodPosts.length, gymPosts.length);

  for (let i = 0; i < maxLength; i += 1) {
    if (foodPosts[i]) result.push(foodPosts[i]);
    if (gymPosts[i]) result.push(gymPosts[i]);
  }

  return result;
}

function formatCompactDate(timestamp?: number) {
  if (!timestamp) return "now";
  return new Date(timestamp).toLocaleDateString();
}

function profileDefaults(uid: string): UserProfile {
  return {
    username: `@user-${uid.slice(0, 5)}`,
    bio: "",
    savedPostIds: [],
    followingIds: [],
    followerIds: [],
  };
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("home");
  const [feedSection, setFeedSection] = useState<FeedSection>("all");
  const [profileSection, setProfileSection] = useState<ProfileSection>("posts");

  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  const [posts, setPosts] = useState<Post[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [loading, setLoading] = useState(true);
  const [feedError, setFeedError] = useState("");
  const [globalMessage, setGlobalMessage] = useState("");
  const [showSplash, setShowSplash] = useState(true);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [selectedSlideshowFiles, setSelectedSlideshowFiles] = useState<File[]>(
    []
  );
  const [slideshowPreviewUrls, setSlideshowPreviewUrls] = useState<string[]>(
    []
  );

  const [uploadCaption, setUploadCaption] = useState("");
  const [uploadCategory, setUploadCategory] = useState<PostCategory>("food");
  const [uploadVisibility, setUploadVisibility] =
    useState<Visibility>("public");
  const [uploadPostType, setUploadPostType] = useState<PostType>("video");
  const [uploadAudioName, setUploadAudioName] = useState("");
  const [uploadRecipeText, setUploadRecipeText] = useState("");
  const [uploadWorkoutSummary, setUploadWorkoutSummary] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");

  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [commentInput, setCommentInput] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyingToCommentId, setReplyingToCommentId] = useState<string | null>(
    null
  );

  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editCaption, setEditCaption] = useState("");
  const [editVisibility, setEditVisibility] = useState<Visibility>("public");
  const [editCategory, setEditCategory] = useState<PostCategory>("food");
  const [editRecipeText, setEditRecipeText] = useState("");
  const [editWorkoutSummary, setEditWorkoutSummary] = useState("");
  const [editAudioName, setEditAudioName] = useState("");

  const [settingsUsername, setSettingsUsername] = useState("");
  const [settingsBio, setSettingsBio] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);

  const [viewedProfileOwnerId, setViewedProfileOwnerId] = useState<
    string | null
  >(null);

  const [busyPostId, setBusyPostId] = useState<string | null>(null);
  const [busyFollowUserId, setBusyFollowUserId] = useState<string | null>(null);

  const [heartBurstPostId, setHeartBurstPostId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const viewedPostsRef = useRef<Set<string>>(new Set());
  const lastTapRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setShowSplash(false);
    }, 1000);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const styleId = "prep-n-rep-ui-styles";

    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.innerHTML = `
      @keyframes heartPop {
        0% { transform: scale(0.6); opacity: 0; }
        20% { transform: scale(1.15); opacity: 1; }
        60% { transform: scale(1); opacity: 1; }
        100% { transform: scale(1.25); opacity: 0; }
      }

      .feed-scroll::-webkit-scrollbar {
        display: none;
      }
    `;
    document.head.appendChild(style);

    return () => {
      const existing = document.getElementById(styleId);
      if (existing) existing.remove();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          setUser(firebaseUser);

          const profileRef = doc(db, "users", firebaseUser.uid);
          const snap = await getDoc(profileRef);

          if (!snap.exists()) {
            const defaults = profileDefaults(firebaseUser.uid);
            await setDoc(profileRef, {
              ...defaults,
              createdAt: serverTimestamp(),
            });
            setProfile(defaults);
            setSettingsUsername(defaults.username);
            setSettingsBio(defaults.bio);
          } else {
            const data = snap.data();
            const nextProfile: UserProfile = {
              username:
                typeof data.username === "string" && data.username.trim() !== ""
                  ? data.username
                  : profileDefaults(firebaseUser.uid).username,
              bio: safeString(data.bio),
              savedPostIds: safeStringArray(data.savedPostIds),
              followingIds: safeStringArray(data.followingIds),
              followerIds: safeStringArray(data.followerIds),
            };
            setProfile(nextProfile);
            setSettingsUsername(nextProfile.username);
            setSettingsBio(nextProfile.bio);
          }

          setAuthReady(true);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("AUTH ERROR:", error);
        setFeedError("Failed to sign in.");
        setAuthReady(true);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!authReady || !user?.uid) return;

    setLoading(true);
    setFeedError("");

    const q = query(collection(db, "videos"));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const nextPosts = snapshot.docs.map(mapPost);
        setPosts(nextPosts);
        setLoading(false);
      },
      (error) => {
        console.error("VIDEO SNAPSHOT ERROR:", error);
        setFeedError(
          typeof error?.message === "string"
            ? error.message
            : "Failed to load videos."
        );
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [authReady, user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;

    const unsubscribe = onSnapshot(
      doc(db, "users", user.uid),
      (snapshot) => {
        if (!snapshot.exists()) return;
        const data = snapshot.data();
        const nextProfile: UserProfile = {
          username:
            typeof data.username === "string" && data.username.trim() !== ""
              ? data.username
              : profileDefaults(user.uid).username,
          bio: safeString(data.bio),
          savedPostIds: safeStringArray(data.savedPostIds),
          followingIds: safeStringArray(data.followingIds),
          followerIds: safeStringArray(data.followerIds),
        };
        setProfile(nextProfile);
        setSettingsUsername(nextProfile.username);
        setSettingsBio(nextProfile.bio);
      },
      (error) => {
        console.error("PROFILE SNAPSHOT ERROR:", error);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    return () => {
      slideshowPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [slideshowPreviewUrls]);

  const savedPostIds = profile?.savedPostIds ?? [];
  const followingIds = profile?.followingIds ?? [];

  const likedVideos = useMemo(
    () => posts.filter((post) => !!user?.uid && post.likedBy.includes(user.uid)),
    [posts, user?.uid]
  );

  const myPosts = useMemo(
    () => posts.filter((post) => post.ownerId === user?.uid),
    [posts, user?.uid]
  );

  const totalLikesOnMyPosts = useMemo(
    () => myPosts.reduce((sum, post) => sum + post.likes, 0),
    [myPosts]
  );

  const savedRecipes = useMemo(
    () =>
      posts.filter(
        (post) => savedPostIds.includes(post.id) && post.category === "food"
      ),
    [posts, savedPostIds]
  );

  const interactionPreference = useMemo(() => {
    const foodLikes = likedVideos.filter(
      (post) => post.category === "food"
    ).length;
    const gymLikes = likedVideos.filter((post) => post.category === "gym").length;
    const foodSaved = posts.filter(
      (post) => savedPostIds.includes(post.id) && post.category === "food"
    ).length;
    const gymSaved = posts.filter(
      (post) => savedPostIds.includes(post.id) && post.category === "gym"
    ).length;

    return {
      food: foodLikes + foodSaved,
      gym: gymLikes + gymSaved,
    };
  }, [likedVideos, posts, savedPostIds]);

  const visiblePosts = useMemo(() => {
    const base = posts.filter((post) => {
      const visibilityOk =
        post.visibility === "public" || post.ownerId === user?.uid;

      const sectionOk =
        feedSection === "all"
          ? true
          : feedSection === "following"
            ? !!post.ownerId && followingIds.includes(post.ownerId)
            : feedSection === "mixed"
              ? true
              : post.category === feedSection;

      return visibilityOk && sectionOk;
    });

    const scorePost = (post: Post) => {
      const recencyBoost = post.createdAt
        ? Math.max(
            0,
            100 - (Date.now() - post.createdAt) / (1000 * 60 * 60 * 24)
          )
        : 0;

      const engagementBoost =
        post.likes * 3 +
        post.comments * 4 +
        post.shares * 3 +
        post.views * 0.05;

      const savedBoost = savedPostIds.includes(post.id) ? 15 : 0;
      const likedBoost =
        !!user?.uid && post.likedBy.includes(user.uid) ? 20 : 0;

      const preferenceBoost =
        post.category === "food"
          ? interactionPreference.food * 2
          : interactionPreference.gym * 2;

      const followingBoost =
        post.ownerId && followingIds.includes(post.ownerId) ? 40 : 0;

      const relevanceBoost = post.isFoodOrGymRelated ? 8 : -10;

      return (
        recencyBoost +
        engagementBoost +
        savedBoost +
        likedBoost +
        preferenceBoost +
        followingBoost +
        relevanceBoost
      );
    };

    const sorted = [...base].sort((a, b) => scorePost(b) - scorePost(a));

    if (feedSection === "mixed") {
      const foodPosts = sorted.filter((post) => post.category === "food");
      const gymPosts = sorted.filter((post) => post.category === "gym");
      return interleavePosts(foodPosts, gymPosts);
    }

    return sorted;
  }, [
    posts,
    user?.uid,
    feedSection,
    savedPostIds,
    interactionPreference.food,
    interactionPreference.gym,
    followingIds,
  ]);

  useEffect(() => {
    if (currentIndex > visiblePosts.length - 1) {
      setCurrentIndex(0);
    }
  }, [currentIndex, visiblePosts.length]);

  useEffect(() => {
    if (tab !== "home") {
      Object.values(videoRefs.current).forEach((video) => video?.pause());
      return;
    }

    visiblePosts.forEach((post, index) => {
      const video = videoRefs.current[post.id];
      if (!video || post.postType === "slideshow") return;

      const isCurrent = index === currentIndex;
      const isNear = Math.abs(index - currentIndex) <= 1;

      video.muted = muted;
      video.preload = isNear ? "auto" : "metadata";

      if (isCurrent) {
        video.play().catch(() => {});
      } else {
        video.pause();
        if (!isNear) {
          video.currentTime = 0;
        }
      }
    });
  }, [currentIndex, muted, tab, visiblePosts]);

  useEffect(() => {
    const currentPost = visiblePosts[currentIndex];
    if (!currentPost || !currentPost.id) return;
    if (viewedPostsRef.current.has(currentPost.id)) return;

    viewedPostsRef.current.add(currentPost.id);

    const incrementView = async () => {
      try {
        const postRef = doc(db, "videos", currentPost.id);
        await runTransaction(db, async (transaction) => {
          const snap = await transaction.get(postRef);
          if (!snap.exists()) return;
          const data = snap.data();
          const currentViews =
            typeof data.viewsCount === "number" ? data.viewsCount : 0;
          transaction.update(postRef, { viewsCount: currentViews + 1 });
        });
      } catch (error) {
        console.error("VIEW INCREMENT ERROR:", error);
      }
    };

    void incrementView();
  }, [currentIndex, visiblePosts]);

  const selectedPost =
    selectedPostId ? posts.find((post) => post.id === selectedPostId) ?? null : null;

  const viewedProfilePosts = useMemo(() => {
    if (!viewedProfileOwnerId) return [];
    return posts
      .filter((post) => post.ownerId === viewedProfileOwnerId)
      .filter(
        (post) => post.visibility === "public" || post.ownerId === user?.uid
      )
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }, [viewedProfileOwnerId, posts, user?.uid]);

  const viewedProfileUsername = useMemo(() => {
    if (!viewedProfileOwnerId) return "@user";
    if (viewedProfileOwnerId === user?.uid) {
      return profile?.username || "@user";
    }
    return (
      viewedProfilePosts[0]?.username ||
      `@user-${viewedProfileOwnerId.slice(0, 5)}`
    );
  }, [viewedProfileOwnerId, viewedProfilePosts, user?.uid, profile?.username]);

  const viewedProfileBio = useMemo(() => {
    if (viewedProfileOwnerId === user?.uid) {
      return profile?.bio || "No bio yet.";
    }
    return "Prep N Rep creator";
  }, [viewedProfileOwnerId, user?.uid, profile?.bio]);

  const contentWarnings = useMemo(() => {
    const text = `${uploadCaption} ${uploadRecipeText} ${uploadWorkoutSummary}`.toLowerCase();

    const foodKeywords = [
      "meal",
      "recipe",
      "cook",
      "protein",
      "chicken",
      "rice",
      "oats",
      "eggs",
      "beef",
      "salmon",
      "food",
    ];

    const gymKeywords = [
      "workout",
      "sets",
      "reps",
      "chest",
      "back",
      "legs",
      "lift",
      "squat",
      "bench",
      "deadlift",
      "gym",
    ];

    const hasFood = foodKeywords.some((word) => text.includes(word));
    const hasGym = gymKeywords.some((word) => text.includes(word));

    const warnings: string[] = [];

    if (uploadCategory === "food" && !hasFood) {
      warnings.push(
        "This post is marked as food, but the text does not strongly look food-related yet."
      );
    }

    if (uploadCategory === "gym" && !hasGym) {
      warnings.push(
        "This post is marked as gym, but the text does not strongly look gym-related yet."
      );
    }

    return warnings;
  }, [uploadCaption, uploadCategory, uploadRecipeText, uploadWorkoutSummary]);

  const resetCreateForm = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    slideshowPreviewUrls.forEach((url) => URL.revokeObjectURL(url));

    setSelectedFile(null);
    setPreviewUrl("");
    setSelectedSlideshowFiles([]);
    setSlideshowPreviewUrls([]);
    setUploadCaption("");
    setUploadCategory("food");
    setUploadVisibility("public");
    setUploadPostType("video");
    setUploadAudioName("");
    setUploadRecipeText("");
    setUploadWorkoutSummary("");
    setUploadProgress(0);
    setUploadError("");
  };

  const handleScroll = () => {
    const container = containerRef.current;
    if (!container) return;

    const newIndex = Math.round(container.scrollTop / container.clientHeight);

    if (
      newIndex !== currentIndex &&
      newIndex >= 0 &&
      newIndex < visiblePosts.length
    ) {
      setCurrentIndex(newIndex);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;

    setUploadError("");
    setGlobalMessage("");
    setUploadProgress(0);

    if (!file) {
      setSelectedFile(null);
      setPreviewUrl("");
      return;
    }

    if (!file.type.startsWith("video/")) {
      setSelectedFile(null);
      setPreviewUrl("");
      setUploadError("Please choose a video file.");
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleSlideshowFilesChange = (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(event.target.files ?? []);

    setUploadError("");
    setGlobalMessage("");

    slideshowPreviewUrls.forEach((url) => URL.revokeObjectURL(url));

    if (!files.length) {
      setSelectedSlideshowFiles([]);
      setSlideshowPreviewUrls([]);
      return;
    }

    const imageFiles = files.filter((file) => file.type.startsWith("image/"));

    if (imageFiles.length !== files.length) {
      setUploadError("Please choose image files only for a slideshow.");
      setSelectedSlideshowFiles([]);
      setSlideshowPreviewUrls([]);
      return;
    }

    setSelectedSlideshowFiles(imageFiles);
    setSlideshowPreviewUrls(imageFiles.map((file) => URL.createObjectURL(file)));
  };

  const handleUpload = async () => {
    if (!user?.uid || !profile) {
      setUploadError("User profile is not ready yet.");
      return;
    }

    if (!profile.username.trim()) {
      setUploadError("Please add a username in settings first.");
      return;
    }

    if (!uploadCaption.trim()) {
      setUploadError("Please add a caption.");
      return;
    }

    if (uploadCategory === "food" && !uploadRecipeText.trim()) {
      setUploadError("Food posts need a recipe section.");
      return;
    }

    if (uploadCategory === "gym" && !uploadWorkoutSummary.trim()) {
      setUploadError("Gym posts need a workout section.");
      return;
    }

    if (uploadPostType === "video" && !selectedFile) {
      setUploadError("Please choose a video file.");
      return;
    }

    if (uploadPostType === "slideshow" && selectedSlideshowFiles.length === 0) {
      setUploadError("Please choose slideshow images.");
      return;
    }

    setUploading(true);
    setUploadError("");
    setGlobalMessage("");

    try {
      let videoUrl = "";
      let storagePath = "";
      let slideshowSlides: SlideshowSlide[] = [];
      let slideshowStoragePaths: string[] = [];

      if (uploadPostType === "video" && selectedFile) {
        const safeFileName = `${Date.now()}-${selectedFile.name.replace(/\s+/g, "-")}`;
        const storageRef = ref(storage, `videos/${user.uid}/${safeFileName}`);
        const uploadTask = uploadBytesResumable(storageRef, selectedFile);

        await new Promise<void>((resolve, reject) => {
          uploadTask.on(
            "state_changed",
            (snapshot) => {
              const progress =
                (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
              setUploadProgress(Math.round(progress));
            },
            (error) => reject(error),
            () => resolve()
          );
        });

        videoUrl = await getDownloadURL(uploadTask.snapshot.ref);
        storagePath = uploadTask.snapshot.ref.fullPath;
      }

      if (uploadPostType === "slideshow" && selectedSlideshowFiles.length) {
        const uploadedSlides = await Promise.all(
          selectedSlideshowFiles.map(async (file, index) => {
            const safeFileName = `${Date.now()}-${index}-${file.name.replace(/\s+/g, "-")}`;
            const slideRef = ref(storage, `slideshows/${user.uid}/${safeFileName}`);

            await new Promise<void>((resolve, reject) => {
              const task = uploadBytesResumable(slideRef, file);
              task.on(
                "state_changed",
                undefined,
                (error) => reject(error),
                () => resolve()
              );
            });

            const imageUrl = await getDownloadURL(slideRef);
            slideshowStoragePaths.push(slideRef.fullPath);

            return {
              id: `slide-${Date.now()}-${index}`,
              imageUrl,
            };
          })
        );

        slideshowSlides = uploadedSlides;
      }

      await addDoc(collection(db, "videos"), {
        videoUrl,
        username: profile.username.trim(),
        caption: uploadCaption.trim(),
        category: uploadCategory,
        visibility: uploadVisibility,
        ownerId: user.uid,
        postType: uploadPostType,
        audioName: uploadAudioName.trim(),
        recipeText: uploadCategory === "food" ? uploadRecipeText.trim() : "",
        workoutSummary:
          uploadCategory === "gym" ? uploadWorkoutSummary.trim() : "",
        slideshowSlides,
        slideshowStoragePaths,
        likedBy: [],
        dislikedBy: [],
        likesCount: 0,
        dislikesCount: 0,
        commentsCount: 0,
        sharesCount: 0,
        viewsCount: 0,
        commentsData: [],
        storagePath,
        isFoodOrGymRelated: contentWarnings.length === 0,
        createdAt: serverTimestamp(),
      });

      setGlobalMessage("Post uploaded successfully.");
      resetCreateForm();
      setTab("home");
      setFeedSection("all");
    } catch (error: any) {
      console.error("UPLOAD ERROR:", error);
      setUploadError(
        typeof error?.message === "string"
          ? error.message
          : "Upload failed. Check Firebase Auth, Storage rules, and Firestore rules."
      );
    } finally {
      setUploading(false);
    }
  };

  const handleToggleFollow = async (targetUserId: string | null) => {
    if (!user?.uid || !targetUserId) return;
    if (user.uid === targetUserId) return;
    if (busyFollowUserId) return;

    setBusyFollowUserId(targetUserId);
    setFeedError("");

    try {
      const myRef = doc(db, "users", user.uid);
      const alreadyFollowing = followingIds.includes(targetUserId);
      const nextFollowing = alreadyFollowing
        ? followingIds.filter((id) => id !== targetUserId)
        : [...followingIds, targetUserId];

      await updateDoc(myRef, {
        followingIds: nextFollowing,
      });

      setGlobalMessage(
        alreadyFollowing ? "Unfollowed user." : "Followed user."
      );
    } catch (error) {
      console.error("FOLLOW ERROR:", error);
      setFeedError("Could not update follow status.");
    } finally {
      setBusyFollowUserId(null);
    }
  };

  const handleLike = async (post: Post) => {
    if (!user?.uid || busyPostId) return;

    setBusyPostId(post.id);
    setFeedError("");

    try {
      const postRef = doc(db, "videos", post.id);

      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(postRef);
        if (!snap.exists()) throw new Error("Post not found.");

        const data = snap.data();
        const likedBy = safeStringArray(data.likedBy);
        const hasLiked = likedBy.includes(user.uid);
        const nextLikedBy = hasLiked
          ? likedBy.filter((id) => id !== user.uid)
          : [...likedBy, user.uid];

        transaction.update(postRef, {
          likedBy: nextLikedBy,
          likesCount: nextLikedBy.length,
        });
      });
    } catch (error) {
      console.error("LIKE ERROR:", error);
      setFeedError("Could not update like.");
    } finally {
      setBusyPostId(null);
    }
  };

  const handleVideoTap = (post: Post) => {
    const now = Date.now();
    const lastTap = lastTapRef.current[post.id] ?? 0;
    const isDoubleTap = now - lastTap < 260;

    lastTapRef.current[post.id] = now;

    const video = videoRefs.current[post.id];

    if (isDoubleTap) {
      void handleLike(post);
      setHeartBurstPostId(post.id);

      window.setTimeout(() => {
        setHeartBurstPostId((current) => (current === post.id ? null : current));
      }, 700);

      return;
    }

    setMuted((prev) => {
      const nextMuted = !prev;
      if (video) {
        video.muted = nextMuted;
        if (video.paused) {
          video.play().catch(() => {});
        }
      }
      return nextMuted;
    });
  };

  const handleSaveRecipe = async (post: Post) => {
    if (!user?.uid || !profile) return;
    if (post.category !== "food") return;

    try {
      const profileRef = doc(db, "users", user.uid);
      const alreadySaved = profile.savedPostIds.includes(post.id);
      const nextSavedIds = alreadySaved
        ? profile.savedPostIds.filter((id) => id !== post.id)
        : [...profile.savedPostIds, post.id];

      await updateDoc(profileRef, { savedPostIds: nextSavedIds });
      setGlobalMessage(
        alreadySaved ? "Recipe removed from saved." : "Recipe saved."
      );
    } catch (error) {
      console.error("SAVE RECIPE ERROR:", error);
      setFeedError("Could not update saved recipes.");
    }
  };

  const handleShare = async (post: Post) => {
    try {
      const postRef = doc(db, "videos", post.id);
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(postRef);
        if (!snap.exists()) return;
        const data = snap.data();
        const currentShares =
          typeof data.sharesCount === "number" ? data.sharesCount : 0;
        transaction.update(postRef, { sharesCount: currentShares + 1 });
      });

      if (navigator.share) {
        await navigator.share({
          title: "Prep N Rep",
          text: post.caption,
        });
      } else {
        await navigator.clipboard.writeText(post.caption);
      }

      setGlobalMessage("Share action recorded.");
    } catch (error) {
      console.error("SHARE ERROR:", error);
    }
  };

  const handleDeletePost = async (post: Post) => {
    if (!user?.uid || post.ownerId !== user.uid || busyPostId) return;

    setBusyPostId(post.id);
    setFeedError("");
    setGlobalMessage("");

    try {
      if (post.postType === "video" && post.storagePath) {
        try {
          await deleteObject(ref(storage, post.storagePath));
        } catch (storageError: any) {
          console.error("VIDEO STORAGE DELETE ERROR:", storageError);
          if (storageError?.code !== "storage/object-not-found") {
            setFeedError(
              "Video file could not be removed from storage, but the post will still be deleted."
            );
          }
        }
      }

      if (post.postType === "slideshow" && post.slideshowStoragePaths.length) {
        await Promise.all(
          post.slideshowStoragePaths.map(async (path) => {
            try {
              await deleteObject(ref(storage, path));
            } catch (storageError: any) {
              console.error("SLIDESHOW STORAGE DELETE ERROR:", storageError);
            }
          })
        );
      }

      await deleteDoc(doc(db, "videos", post.id));
      setGlobalMessage("Post deleted.");
    } catch (error: any) {
      console.error("DELETE ERROR:", error);
      setFeedError(
        typeof error?.message === "string"
          ? error.message
          : "Could not delete the post."
      );
    } finally {
      setBusyPostId(null);
    }
  };

  const openEditPost = (post: Post) => {
    setEditingPostId(post.id);
    setEditCaption(post.caption);
    setEditVisibility(post.visibility);
    setEditCategory(post.category);
    setEditRecipeText(post.recipeText);
    setEditWorkoutSummary(post.workoutSummary);
    setEditAudioName(post.audioName);
  };

  const handleSaveEdit = async () => {
    if (!editingPostId || !user?.uid) return;

    const post = posts.find((item) => item.id === editingPostId);
    if (!post || post.ownerId !== user.uid) return;

    try {
      await updateDoc(doc(db, "videos", editingPostId), {
        caption: editCaption.trim(),
        visibility: editVisibility,
        category: editCategory,
        recipeText: editCategory === "food" ? editRecipeText.trim() : "",
        workoutSummary:
          editCategory === "gym" ? editWorkoutSummary.trim() : "",
        audioName: editAudioName.trim(),
      });

      setEditingPostId(null);
      setGlobalMessage("Post updated.");
    } catch (error) {
      console.error("EDIT POST ERROR:", error);
      setFeedError("Could not update post.");
    }
  };

  const handleAddComment = async (event: FormEvent) => {
    event.preventDefault();

    if (!selectedPost || !user?.uid || !profile) return;
    if (!commentInput.trim()) return;

    try {
      const postRef = doc(db, "videos", selectedPost.id);

      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(postRef);
        if (!snap.exists()) throw new Error("Post not found.");

        const data = snap.data();
        const commentsData = safeComments(data.commentsData);

        commentsData.push({
          id: `comment-${Date.now()}`,
          authorId: user.uid,
          authorUsername: profile.username,
          text: commentInput.trim(),
          createdAt: Date.now(),
          replies: [],
        });

        const commentsCount = commentsData.reduce(
          (sum, comment) => sum + 1 + comment.replies.length,
          0
        );

        transaction.update(postRef, {
          commentsData,
          commentsCount,
        });
      });

      setCommentInput("");
    } catch (error) {
      console.error("ADD COMMENT ERROR:", error);
      setFeedError("Could not add comment.");
    }
  };

  const handleAddReply = async (commentId: string) => {
    if (!selectedPost || !user?.uid || !profile) return;

    const replyText = replyDrafts[commentId]?.trim();
    if (!replyText) return;

    try {
      const postRef = doc(db, "videos", selectedPost.id);

      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(postRef);
        if (!snap.exists()) throw new Error("Post not found.");

        const data = snap.data();
        const commentsData = safeComments(data.commentsData).map((comment) => {
          if (comment.id !== commentId) return comment;

          return {
            ...comment,
            replies: [
              ...comment.replies,
              {
                id: `reply-${Date.now()}`,
                authorId: user.uid,
                authorUsername: profile.username,
                text: replyText,
                createdAt: Date.now(),
              },
            ],
          };
        });

        const commentsCount = commentsData.reduce(
          (sum, comment) => sum + 1 + comment.replies.length,
          0
        );

        transaction.update(postRef, {
          commentsData,
          commentsCount,
        });
      });

      setReplyDrafts((prev) => ({ ...prev, [commentId]: "" }));
      setReplyingToCommentId(null);
    } catch (error) {
      console.error("ADD REPLY ERROR:", error);
      setFeedError("Could not add reply.");
    }
  };

  const handleSaveSettings = async () => {
    if (!user?.uid) return;

    if (!settingsUsername.trim()) {
      setFeedError("Username cannot be empty.");
      return;
    }

    setSettingsSaving(true);

    try {
      await setDoc(
        doc(db, "users", user.uid),
        {
          username: settingsUsername.trim(),
          bio: settingsBio.trim(),
          savedPostIds: profile?.savedPostIds ?? [],
          followingIds: profile?.followingIds ?? [],
          followerIds: profile?.followerIds ?? [],
        },
        { merge: true }
      );

      setGlobalMessage("Profile settings saved.");
    } catch (error) {
      console.error("SAVE SETTINGS ERROR:", error);
      setFeedError("Could not save settings.");
    } finally {
      setSettingsSaving(false);
    }
  };

  const renderSectionTabs = () => {
    return (
      <div style={sectionTabsWrapStyle}>
        {(["all", "following", "food", "gym", "mixed"] as FeedSection[]).map(
          (section) => (
            <button
              key={section}
              type="button"
              onClick={() => {
                setFeedSection(section);
                setCurrentIndex(0);
                if (containerRef.current) {
                  containerRef.current.scrollTo({ top: 0 });
                }
              }}
              style={sectionTabButtonStyle(feedSection === section)}
            >
              {section === "all"
                ? "Prep N Rep"
                : section === "following"
                  ? "Following"
                  : section.charAt(0).toUpperCase() + section.slice(1)}
            </button>
          )
        )}
      </div>
    );
  };

  const renderPostDetailsBlock = (post: Post) => {
    const isSavedRecipe = savedPostIds.includes(post.id);

    return (
      <div style={{ marginTop: 10 }}>
        {post.category === "food" ? (
          <div style={detailCardStyle}>
            <div style={detailTitleStyle}>Recipe</div>
            <div style={detailBodyStyle}>
              {post.recipeText || "Recipe placeholder for this food post."}
            </div>
            <button
              type="button"
              onClick={() => handleSaveRecipe(post)}
              style={smallActionButtonStyle(isSavedRecipe)}
            >
              {isSavedRecipe ? "Saved ✓" : "Save Recipe"}
            </button>
          </div>
        ) : (
          <div style={detailCardStyle}>
            <div style={detailTitleStyle}>Workout</div>
            <div style={detailBodyStyle}>
              {post.workoutSummary || "Workout summary placeholder."}
            </div>
          </div>
        )}

        {post.audioName ? (
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.86 }}>
            🎵 {post.audioName}
          </div>
        ) : null}
      </div>
    );
  };

  const renderHome = () => {
    if (!authReady || loading) {
      return <div style={centeredMessageStyle}>Loading Prep N Rep...</div>;
    }

    if (feedError) {
      return <div style={centeredMessageStyle}>{feedError}</div>;
    }

    if (!visiblePosts.length) {
      return (
        <div style={centeredMessageStyle}>
          {feedSection === "following"
            ? "No posts from followed users yet."
            : "No posts found for this section yet."}
        </div>
      );
    }

    return (
      <>
        {renderSectionTabs()}

        <div
          ref={containerRef}
          onScroll={handleScroll}
          style={feedContainerStyle}
          className="feed-scroll"
        >
          {visiblePosts.map((post) => {
            const isOwner = post.ownerId === user?.uid;
            const isLiked = !!user?.uid && post.likedBy.includes(user.uid);
            const isBusy = busyPostId === post.id;
            const isFollowingCreator =
              !!post.ownerId && followingIds.includes(post.ownerId);

            return (
              <div key={post.id} style={feedItemStyle}>
                {post.postType === "slideshow" ? (
                  <div style={slideshowWrapStyle}>
                    {post.slideshowSlides.length ? (
                      post.slideshowSlides.map((slide, index) => (
                        <div key={slide.id} style={slideshowSlideStyle}>
                          <img
                            src={slide.imageUrl}
                            alt={`Slide ${index + 1}`}
                            style={slideshowImageStyle}
                          />
                        </div>
                      ))
                    ) : (
                      <div style={slideshowEmptyStyle}>No slideshow images.</div>
                    )}
                  </div>
                ) : (
                  <video
                    ref={(el) => {
                      videoRefs.current[post.id] = el;
                    }}
                    src={post.videoUrl}
                    muted={muted}
                    loop
                    playsInline
                    controls={false}
                    preload="metadata"
                    style={videoStyle}
                    onClick={() => handleVideoTap(post)}
                  />
                )}

                {heartBurstPostId === post.id ? (
                  <div style={heartBurstStyle}>❤️</div>
                ) : null}

                <div style={overlayStyle} />

                <div style={topInfoStyle}>
                  <div style={pillStyle}>{post.category.toUpperCase()}</div>
                  {!post.isFoodOrGymRelated ? (
                    <div style={warningPillStyle}>CHECK CONTENT</div>
                  ) : null}
                  {post.postType === "video" ? (
                    <div style={pillStyle}>{muted ? "Tap for sound" : "Sound on"}</div>
                  ) : null}
                </div>

                <div style={postInfoStyle}>
                  <div style={usernameRowStyle}>
                    <button
                      type="button"
                      onClick={() =>
                        post.ownerId && setViewedProfileOwnerId(post.ownerId)
                      }
                      style={usernameLinkStyle}
                    >
                      {post.username}
                    </button>

                    {!isOwner && post.ownerId ? (
                      <button
                        type="button"
                        onClick={() => handleToggleFollow(post.ownerId)}
                        disabled={busyFollowUserId === post.ownerId}
                        style={followButtonStyle(isFollowingCreator)}
                      >
                        {busyFollowUserId === post.ownerId
                          ? "..."
                          : isFollowingCreator
                            ? "Following"
                            : "Follow"}
                      </button>
                    ) : null}
                  </div>

                  <div style={captionStyle}>{post.caption}</div>

                  <div style={metaRowStyle}>
                    <span>👀 {post.views}</span>
                    <span>🗓 {formatCompactDate(post.createdAt)}</span>
                    {isOwner ? <span>Your post</span> : null}
                  </div>

                  {renderPostDetailsBlock(post)}
                </div>

                <div style={actionsWrapperStyle}>
                  <button
                    type="button"
                    style={reactionButtonStyle(isLiked)}
                    onClick={() => handleLike(post)}
                    disabled={isBusy}
                  >
                    ❤️
                    <div style={actionLabelStyle}>{post.likes}</div>
                  </button>

                  <button
                    type="button"
                    style={actionButtonStyle}
                    onClick={() => setSelectedPostId(post.id)}
                  >
                    💬
                    <div style={actionLabelStyle}>{post.comments}</div>
                  </button>

                  <button
                    type="button"
                    style={actionButtonStyle}
                    onClick={() => handleShare(post)}
                  >
                    ↗
                    <div style={actionLabelStyle}>{post.shares}</div>
                  </button>

                  {isOwner ? (
                    <>
                      <button
                        type="button"
                        style={ownerActionButtonStyle}
                        onClick={() => openEditPost(post)}
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        style={ownerActionButtonStyle}
                        onClick={() => handleDeletePost(post)}
                        disabled={isBusy}
                      >
                        🗑️
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  };

  const renderCreate = () => {
    return (
      <div style={screenStyle}>
        <div style={pageHeaderStyle}>
          <div>
            <h2 style={{ margin: 0 }}>Create</h2>
            <p style={pageSubtextStyle}>
              Clean vertical posts for food and gym content.
            </p>
          </div>
        </div>

        <div style={formCardStyle}>
          <label style={labelStyle}>Caption</label>
          <textarea
            value={uploadCaption}
            onChange={(e) => setUploadCaption(e.target.value)}
            placeholder="What is this post about?"
            style={textareaStyle}
          />

          <div style={twoColGridStyle}>
            <div>
              <label style={labelStyle}>Category</label>
              <select
                value={uploadCategory}
                onChange={(e) => setUploadCategory(e.target.value as PostCategory)}
                style={inputStyle}
              >
                <option value="food">Food</option>
                <option value="gym">Gym</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Visibility</label>
              <select
                value={uploadVisibility}
                onChange={(e) => setUploadVisibility(e.target.value as Visibility)}
                style={inputStyle}
              >
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
            </div>
          </div>

          <div style={twoColGridStyle}>
            <div>
              <label style={labelStyle}>Post Type</label>
              <select
                value={uploadPostType}
                onChange={(e) => setUploadPostType(e.target.value as PostType)}
                style={inputStyle}
              >
                <option value="video">Video</option>
                <option value="slideshow">Slideshow</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Music / Audio</label>
              <input
                value={uploadAudioName}
                onChange={(e) => setUploadAudioName(e.target.value)}
                placeholder="Audio name"
                style={inputStyle}
              />
            </div>
          </div>

          {uploadCategory === "food" ? (
            <>
              <label style={labelStyle}>Recipe</label>
              <textarea
                value={uploadRecipeText}
                onChange={(e) => setUploadRecipeText(e.target.value)}
                placeholder="Ingredients, measurements, and instructions"
                style={textareaStyle}
              />
            </>
          ) : (
            <>
              <label style={labelStyle}>Workout Split / Sets</label>
              <textarea
                value={uploadWorkoutSummary}
                onChange={(e) => setUploadWorkoutSummary(e.target.value)}
                placeholder="Example: Push day - bench 4x8, incline dumbbell 3x10..."
                style={textareaStyle}
              />
            </>
          )}

          {uploadPostType === "video" ? (
            <>
              <label style={labelStyle}>Video File</label>
              <input type="file" accept="video/*" onChange={handleFileChange} />

              {previewUrl ? (
                <div style={{ marginTop: 18 }}>
                  <video
                    src={previewUrl}
                    controls
                    playsInline
                    style={previewStyle}
                  />
                </div>
              ) : null}
            </>
          ) : (
            <>
              <label style={labelStyle}>Slideshow Images</label>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleSlideshowFilesChange}
              />

              {slideshowPreviewUrls.length ? (
                <div style={slideshowPreviewGridStyle}>
                  {slideshowPreviewUrls.map((url, index) => (
                    <img
                      key={`${url}-${index}`}
                      src={url}
                      alt={`Slide ${index + 1}`}
                      style={slideshowPreviewImageStyle}
                    />
                  ))}
                </div>
              ) : null}
            </>
          )}

          <div style={editorPlaceholderStyle}>
            <div style={{ fontWeight: 900 }}>Simple editor coming next</div>
            <div style={{ marginTop: 6, opacity: 0.82 }}>
              This version supports cleaner uploads, slideshow images, and a more mobile-first feed.
            </div>
          </div>

          {contentWarnings.length ? (
            <div style={warningBoxStyle}>
              {contentWarnings.map((warning) => (
                <div key={warning}>{warning}</div>
              ))}
            </div>
          ) : null}

          {uploading ? (
            <div style={statusTextStyle}>Uploading... {uploadProgress}%</div>
          ) : null}
          {uploadError ? <div style={errorTextStyle}>{uploadError}</div> : null}
          {globalMessage ? (
            <div style={successTextStyle}>{globalMessage}</div>
          ) : null}

          <button
            type="button"
            onClick={handleUpload}
            disabled={uploading}
            style={primaryButtonStyle(uploading)}
          >
            {uploading ? "Uploading..." : "Upload Post"}
          </button>
        </div>
      </div>
    );
  };

  const renderProfileSectionTabs = () => (
    <div style={miniTabsRowStyle}>
      {(["posts", "saved", "liked", "settings"] as ProfileSection[]).map(
        (section) => (
          <button
            key={section}
            type="button"
            onClick={() => setProfileSection(section)}
            style={miniTabStyle(profileSection === section)}
          >
            {section.charAt(0).toUpperCase() + section.slice(1)}
          </button>
        )
      )}
    </div>
  );

  const renderProfile = () => {
    const followingList = followingIds.map((uid) => {
      const matchingPost = posts.find((post) => post.ownerId === uid);
      return {
        uid,
        username: matchingPost?.username || `@user-${uid.slice(0, 5)}`,
      };
    });

    return (
      <div style={screenStyle}>
        <div style={pageHeaderStyle}>
          <div>
            <h2 style={{ margin: 0 }}>Profile</h2>
            <p style={pageSubtextStyle}>
              Manage your posts, recipes, likes, and settings.
            </p>
          </div>
        </div>

        <div style={profileCardStyle}>
          <div style={{ fontSize: 24, fontWeight: 900 }}>
            {profile?.username ?? "@user"}
          </div>
          <div style={{ color: "#b8bdd1", marginTop: 8 }}>
            {profile?.bio || "No bio yet."}
          </div>
          <div style={profileStatsStyle}>
            <div>Posts: {myPosts.length}</div>
            <div>Total Likes: {totalLikesOnMyPosts}</div>
            <div>Saved Recipes: {savedRecipes.length}</div>
            <div>Following: {profile?.followingIds.length ?? 0}</div>
          </div>
        </div>

        {renderProfileSectionTabs()}

        {profileSection === "posts" ? (
          <div style={listCardStyle}>
            <div style={sectionTitleStyle}>My Posts</div>
            {!myPosts.length ? (
              <div style={emptyStateStyle}>No posts yet.</div>
            ) : (
              myPosts.map((post) => (
                <div key={post.id} style={profileListItemStyle}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{post.caption}</div>
                    <div style={smallMetaStyle}>
                      {post.category.toUpperCase()} • {post.visibility.toUpperCase()} • ❤️{" "}
                      {post.likes}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : null}

        {profileSection === "saved" ? (
          <div style={listCardStyle}>
            <div style={sectionTitleStyle}>Saved Recipes</div>
            {!savedRecipes.length ? (
              <div style={emptyStateStyle}>No saved recipes yet.</div>
            ) : (
              savedRecipes.map((post) => (
                <div key={post.id} style={profileListItemStyle}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{post.caption}</div>
                    <div style={smallMetaStyle}>
                      {post.recipeText || "Recipe placeholder"}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : null}

        {profileSection === "liked" ? (
          <div style={listCardStyle}>
            <div style={sectionTitleStyle}>Liked Videos</div>
            {!likedVideos.length ? (
              <div style={emptyStateStyle}>No liked videos yet.</div>
            ) : (
              likedVideos.map((post) => (
                <div key={post.id} style={profileListItemStyle}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{post.caption}</div>
                    <div style={smallMetaStyle}>
                      {post.category.toUpperCase()} • by {post.username}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : null}

        {profileSection === "settings" ? (
          <div style={listCardStyle}>
            <div style={sectionTitleStyle}>Settings</div>

            <label style={labelStyle}>Username</label>
            <input
              value={settingsUsername}
              onChange={(e) => setSettingsUsername(e.target.value)}
              style={inputStyle}
              placeholder="@username"
            />

            <label style={labelStyle}>Bio</label>
            <textarea
              value={settingsBio}
              onChange={(e) => setSettingsBio(e.target.value)}
              style={textareaStyle}
              placeholder="Tell people about your prep and training"
            />

            <div style={{ marginTop: 22 }}>
              <div style={sectionTitleStyle}>Following</div>
              {!followingList.length ? (
                <div style={emptyStateStyle}>You are not following anyone yet.</div>
              ) : (
                followingList.map((item) => (
                  <div key={item.uid} style={profileListItemStyle}>
                    <div style={followingRowStyle}>
                      <button
                        type="button"
                        onClick={() => setViewedProfileOwnerId(item.uid)}
                        style={profileUsernameLinkStyle}
                      >
                        {item.username}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleFollow(item.uid)}
                        disabled={busyFollowUserId === item.uid}
                        style={followButtonStyle(true)}
                      >
                        {busyFollowUserId === item.uid ? "..." : "Unfollow"}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <button
              type="button"
              onClick={handleSaveSettings}
              disabled={settingsSaving}
              style={primaryButtonStyle(settingsSaving)}
            >
              {settingsSaving ? "Saving..." : "Save Settings"}
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div style={appStyle}>
      {showSplash ? (
        <div style={splashStyle}>
          <div style={splashOrbStyle} />
          <div style={splashTitleStyle}>Prep N Rep</div>
          <div style={splashSubtitleStyle}>Food prep. Gym content. One feed.</div>
        </div>
      ) : (
        <>
          {tab === "home" && renderHome()}
          {tab === "create" && renderCreate()}
          {tab === "profile" && renderProfile()}

          {selectedPost ? (
            <div style={modalBackdropStyle} onClick={() => setSelectedPostId(null)}>
              <div
                style={modalCardStyle}
                onClick={(event) => event.stopPropagation()}
              >
                <div style={modalHeaderStyle}>
                  <div style={{ fontWeight: 900 }}>Comments</div>
                  <button
                    type="button"
                    onClick={() => setSelectedPostId(null)}
                    style={closeButtonStyle}
                  >
                    ✕
                  </button>
                </div>

                <div style={modalPostCaptionStyle}>{selectedPost.caption}</div>

                <div style={commentsWrapStyle}>
                  {!selectedPost.commentsData.length ? (
                    <div style={emptyStateStyle}>No comments yet.</div>
                  ) : (
                    selectedPost.commentsData.map((comment) => (
                      <div key={comment.id} style={commentCardStyle}>
                        <div style={commentHeaderStyle}>
                          <span style={{ fontWeight: 700 }}>
                            {comment.authorUsername}
                          </span>
                          {comment.authorId === selectedPost.ownerId ? (
                            <span style={authorBadgeStyle}>Author</span>
                          ) : null}
                        </div>

                        <div style={{ marginTop: 6 }}>{comment.text}</div>

                        <div style={smallMetaStyle}>
                          {formatCompactDate(comment.createdAt)}
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            setReplyingToCommentId(
                              replyingToCommentId === comment.id ? null : comment.id
                            )
                          }
                          style={inlineTextButtonStyle}
                        >
                          Reply
                        </button>

                        {comment.replies.length ? (
                          <div style={repliesWrapStyle}>
                            {comment.replies.map((reply) => (
                              <div key={reply.id} style={replyCardStyle}>
                                <div style={commentHeaderStyle}>
                                  <span style={{ fontWeight: 700 }}>
                                    {reply.authorUsername}
                                  </span>
                                  {reply.authorId === selectedPost.ownerId ? (
                                    <span style={authorBadgeStyle}>Author</span>
                                  ) : null}
                                </div>
                                <div style={{ marginTop: 4 }}>{reply.text}</div>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {replyingToCommentId === comment.id ? (
                          <div style={{ marginTop: 10 }}>
                            <textarea
                              value={replyDrafts[comment.id] ?? ""}
                              onChange={(e) =>
                                setReplyDrafts((prev) => ({
                                  ...prev,
                                  [comment.id]: e.target.value,
                                }))
                              }
                              placeholder="Write a reply"
                              style={replyTextareaStyle}
                            />
                            <button
                              type="button"
                              onClick={() => handleAddReply(comment.id)}
                              style={smallSolidButtonStyle}
                            >
                              Post Reply
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={handleAddComment} style={{ marginTop: 14 }}>
                  <textarea
                    value={commentInput}
                    onChange={(e) => setCommentInput(e.target.value)}
                    placeholder="Add a comment"
                    style={textareaStyle}
                  />
                  <button type="submit" style={smallSolidButtonStyle}>
                    Post Comment
                  </button>
                </form>
              </div>
            </div>
          ) : null}

          {editingPostId ? (
            <div style={modalBackdropStyle} onClick={() => setEditingPostId(null)}>
              <div
                style={modalCardStyle}
                onClick={(event) => event.stopPropagation()}
              >
                <div style={modalHeaderStyle}>
                  <div style={{ fontWeight: 900 }}>Edit Post</div>
                  <button
                    type="button"
                    onClick={() => setEditingPostId(null)}
                    style={closeButtonStyle}
                  >
                    ✕
                  </button>
                </div>

                <label style={labelStyle}>Caption</label>
                <textarea
                  value={editCaption}
                  onChange={(e) => setEditCaption(e.target.value)}
                  style={textareaStyle}
                />

                <label style={labelStyle}>Category</label>
                <select
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value as PostCategory)}
                  style={inputStyle}
                >
                  <option value="food">Food</option>
                  <option value="gym">Gym</option>
                </select>

                <label style={labelStyle}>Visibility</label>
                <select
                  value={editVisibility}
                  onChange={(e) => setEditVisibility(e.target.value as Visibility)}
                  style={inputStyle}
                >
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </select>

                <label style={labelStyle}>Audio Name</label>
                <input
                  value={editAudioName}
                  onChange={(e) => setEditAudioName(e.target.value)}
                  style={inputStyle}
                />

                {editCategory === "food" ? (
                  <>
                    <label style={labelStyle}>Recipe</label>
                    <textarea
                      value={editRecipeText}
                      onChange={(e) => setEditRecipeText(e.target.value)}
                      style={textareaStyle}
                    />
                  </>
                ) : (
                  <>
                    <label style={labelStyle}>Workout Summary</label>
                    <textarea
                      value={editWorkoutSummary}
                      onChange={(e) => setEditWorkoutSummary(e.target.value)}
                      style={textareaStyle}
                    />
                  </>
                )}

                <button
                  type="button"
                  onClick={handleSaveEdit}
                  style={smallSolidButtonStyle}
                >
                  Save Changes
                </button>
              </div>
            </div>
          ) : null}

          {viewedProfileOwnerId ? (
            <div
              style={modalBackdropStyle}
              onClick={() => setViewedProfileOwnerId(null)}
            >
              <div
                style={modalCardStyle}
                onClick={(event) => event.stopPropagation()}
              >
                <div style={modalHeaderStyle}>
                  <div style={{ fontWeight: 900 }}>Profile</div>
                  <button
                    type="button"
                    onClick={() => setViewedProfileOwnerId(null)}
                    style={closeButtonStyle}
                  >
                    ✕
                  </button>
                </div>

                <div style={profileViewerCardStyle}>
                  <div style={{ fontSize: 24, fontWeight: 900 }}>
                    {viewedProfileUsername}
                  </div>
                  <div style={{ marginTop: 8, color: "#bcc4e2" }}>
                    {viewedProfileBio}
                  </div>
                  <div style={profileStatsStyle}>
                    <div>Posts: {viewedProfilePosts.length}</div>
                    <div>
                      Total Likes:{" "}
                      {viewedProfilePosts.reduce((sum, post) => sum + post.likes, 0)}
                    </div>
                  </div>

                  {viewedProfileOwnerId !== user?.uid ? (
                    <button
                      type="button"
                      onClick={() => handleToggleFollow(viewedProfileOwnerId)}
                      disabled={busyFollowUserId === viewedProfileOwnerId}
                      style={{
                        ...followButtonStyle(
                          followingIds.includes(viewedProfileOwnerId)
                        ),
                        marginTop: 14,
                      }}
                    >
                      {busyFollowUserId === viewedProfileOwnerId
                        ? "..."
                        : followingIds.includes(viewedProfileOwnerId)
                          ? "Following"
                          : "Follow"}
                    </button>
                  ) : null}
                </div>

                <div style={{ marginTop: 18 }}>
                  <div style={sectionTitleStyle}>Posts</div>
                  {!viewedProfilePosts.length ? (
                    <div style={emptyStateStyle}>No visible posts yet.</div>
                  ) : (
                    viewedProfilePosts.map((post) => (
                      <div key={post.id} style={profileListItemStyle}>
                        <div>
                          <div style={{ fontWeight: 700 }}>{post.caption}</div>
                          <div style={smallMetaStyle}>
                            {post.category.toUpperCase()} • ❤️ {post.likes} • 💬 {post.comments}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : null}

          <nav style={navStyle}>
            <button
              onClick={() => setTab("home")}
              style={navButtonStyle(tab === "home")}
            >
              Home
            </button>
            <button
              onClick={() => setTab("create")}
              style={navButtonStyle(tab === "create")}
            >
              Create
            </button>
            <button
              onClick={() => setTab("profile")}
              style={navButtonStyle(tab === "profile")}
            >
              Profile
            </button>
          </nav>
        </>
      )}
    </div>
  );
}

const appStyle: CSSProperties = {
  minHeight: "100vh",
  background: "#000",
  color: "white",
};

const splashStyle: CSSProperties = {
  minHeight: "100vh",
  background:
    "radial-gradient(circle at top, rgba(255,255,255,0.08) 0%, rgba(15,15,18,1) 42%, rgba(0,0,0,1) 100%)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  padding: 24,
  position: "relative",
  overflow: "hidden",
};

const splashOrbStyle: CSSProperties = {
  width: 180,
  height: 180,
  borderRadius: "50%",
  background:
    "radial-gradient(circle, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.1) 35%, rgba(255,255,255,0) 70%)",
  filter: "blur(10px)",
  position: "absolute",
  top: "18%",
};

const splashTitleStyle: CSSProperties = {
  fontSize: 42,
  fontWeight: 900,
  letterSpacing: 0.8,
  position: "relative",
  zIndex: 1,
};

const splashSubtitleStyle: CSSProperties = {
  marginTop: 12,
  color: "#c8c8d3",
  fontSize: 15,
  position: "relative",
  zIndex: 1,
};

const screenStyle: CSSProperties = {
  minHeight: `calc(100vh - ${BOTTOM_NAV_HEIGHT}px)`,
  padding: `${TOP_NAV_HEIGHT + 20}px 16px 20px 16px`,
  color: "white",
};

const centeredMessageStyle: CSSProperties = {
  height: `calc(100vh - ${BOTTOM_NAV_HEIGHT}px)`,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#e8ebff",
  textAlign: "center",
  padding: 24,
};

const pageHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  marginBottom: 18,
};

const pageSubtextStyle: CSSProperties = {
  marginTop: 8,
  marginBottom: 0,
  color: "#a9a9b6",
};

const sectionTabsWrapStyle: CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  zIndex: 20,
  display: "flex",
  gap: 8,
  overflowX: "auto",
  padding: "10px 12px",
  background: "rgba(0,0,0,0.72)",
  backdropFilter: "blur(14px)",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
};

const feedContainerStyle: CSSProperties = {
  height: `calc(100vh - ${BOTTOM_NAV_HEIGHT}px)`,
  overflowY: "scroll",
  scrollSnapType: "y mandatory",
  marginTop: TOP_NAV_HEIGHT,
  scrollbarWidth: "none",
  msOverflowStyle: "none",
};

const feedItemStyle: CSSProperties = {
  height: `calc(100vh - ${BOTTOM_NAV_HEIGHT + TOP_NAV_HEIGHT}px)`,
  position: "relative",
  scrollSnapAlign: "start",
  overflow: "hidden",
  marginBottom: 0,
  background: "#000",
};

const videoStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

const slideshowWrapStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  overflowX: "auto",
  overflowY: "hidden",
  scrollSnapType: "x mandatory",
  WebkitOverflowScrolling: "touch",
  background: "#000",
};

const slideshowSlideStyle: CSSProperties = {
  minWidth: "100%",
  height: "100%",
  scrollSnapAlign: "start",
  flexShrink: 0,
};

const slideshowImageStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
};

const slideshowEmptyStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "white",
  background: "#111",
};

const heartBurstStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 86,
  zIndex: 3,
  pointerEvents: "none",
  textShadow: "0 8px 30px rgba(0,0,0,0.45)",
  animation: "heartPop 0.7s ease",
};

const overlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background:
    "linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.24) 35%, rgba(0,0,0,0.78) 100%)",
  pointerEvents: "none",
};

const topInfoStyle: CSSProperties = {
  position: "absolute",
  top: 16,
  left: 16,
  display: "flex",
  gap: 8,
  zIndex: 2,
  flexWrap: "wrap",
};

const pillStyle: CSSProperties = {
  background: "rgba(0,0,0,0.42)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 999,
  padding: "7px 11px",
  fontSize: 12,
  fontWeight: 800,
  color: "white",
  backdropFilter: "blur(12px)",
};

const warningPillStyle: CSSProperties = {
  ...pillStyle,
  background: "rgba(130,83,22,0.72)",
};

const postInfoStyle: CSSProperties = {
  position: "absolute",
  bottom: 88,
  left: 14,
  color: "white",
  maxWidth: "68%",
  zIndex: 2,
};

const usernameRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};

const usernameLinkStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  color: "white",
  fontWeight: 900,
  fontSize: 19,
  padding: 0,
  cursor: "pointer",
  textAlign: "left",
};

const profileUsernameLinkStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  color: "white",
  padding: 0,
  cursor: "pointer",
  fontWeight: 700,
};

const captionStyle: CSSProperties = {
  marginTop: 8,
  lineHeight: 1.42,
  fontSize: 15,
};

const metaRowStyle: CSSProperties = {
  marginTop: 9,
  fontSize: 12,
  opacity: 0.9,
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  color: "#d7d7df",
};

const detailCardStyle: CSSProperties = {
  marginTop: 10,
  background: "rgba(0,0,0,0.34)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  padding: 12,
  backdropFilter: "blur(10px)",
};

const detailTitleStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  opacity: 0.92,
};

const detailBodyStyle: CSSProperties = {
  marginTop: 6,
  fontSize: 13,
  lineHeight: 1.5,
};

const actionsWrapperStyle: CSSProperties = {
  position: "absolute",
  right: 10,
  bottom: 92,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  color: "white",
  textAlign: "center",
  zIndex: 2,
};

const actionButtonStyle: CSSProperties = {
  background: "rgba(0,0,0,0.38)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "white",
  fontSize: 20,
  cursor: "pointer",
  borderRadius: 16,
  padding: "8px 9px",
  backdropFilter: "blur(12px)",
};

const ownerActionButtonStyle: CSSProperties = {
  background: "rgba(0,0,0,0.42)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "white",
  fontSize: 18,
  cursor: "pointer",
  borderRadius: 14,
  padding: "8px 10px",
  backdropFilter: "blur(12px)",
};

const actionLabelStyle: CSSProperties = {
  fontSize: 12,
  marginTop: 4,
};

const formCardStyle: CSSProperties = {
  maxWidth: 760,
  background: "rgba(12,12,15,0.96)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 24,
  padding: 20,
  boxShadow: "0 18px 50px rgba(0,0,0,0.3)",
};

const listCardStyle: CSSProperties = {
  maxWidth: 760,
  background: "rgba(12,12,15,0.96)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 24,
  padding: 20,
  marginTop: 18,
  boxShadow: "0 18px 50px rgba(0,0,0,0.3)",
};

const twoColGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 12,
};

const labelStyle: CSSProperties = {
  display: "block",
  marginTop: 14,
  marginBottom: 8,
  fontSize: 14,
  color: "#d7dcf0",
  fontWeight: 700,
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: 13,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.04)",
  color: "white",
  outline: "none",
};

const textareaStyle: CSSProperties = {
  width: "100%",
  minHeight: 100,
  padding: 13,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.04)",
  color: "white",
  outline: "none",
  resize: "vertical",
};

const replyTextareaStyle: CSSProperties = {
  ...textareaStyle,
  minHeight: 70,
};

const previewStyle: CSSProperties = {
  width: "100%",
  maxHeight: 440,
  borderRadius: 18,
  background: "black",
  border: "1px solid rgba(255,255,255,0.08)",
};

const slideshowPreviewGridStyle: CSSProperties = {
  marginTop: 16,
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 10,
};

const slideshowPreviewImageStyle: CSSProperties = {
  width: "100%",
  aspectRatio: "3 / 4",
  objectFit: "cover",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "#111",
};

const editorPlaceholderStyle: CSSProperties = {
  marginTop: 16,
  background: "rgba(255,255,255,0.03)",
  border: "1px dashed rgba(255,255,255,0.14)",
  borderRadius: 16,
  padding: 16,
  color: "#cfd6f6",
};

const warningBoxStyle: CSSProperties = {
  marginTop: 16,
  background: "rgba(120,60,0,0.22)",
  border: "1px solid rgba(255,170,80,0.35)",
  borderRadius: 16,
  padding: 12,
  color: "#ffd1a0",
  display: "grid",
  gap: 6,
};

const statusTextStyle: CSSProperties = {
  marginTop: 16,
  color: "#d8deff",
};

const errorTextStyle: CSSProperties = {
  marginTop: 16,
  color: "#ff9a9a",
};

const successTextStyle: CSSProperties = {
  marginTop: 16,
  color: "#8dffb8",
};

const profileCardStyle: CSSProperties = {
  maxWidth: 760,
  background:
    "linear-gradient(135deg, rgba(28,28,36,0.98) 0%, rgba(10,10,13,0.98) 100%)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 24,
  padding: 20,
  boxShadow: "0 18px 50px rgba(0,0,0,0.3)",
};

const profileViewerCardStyle: CSSProperties = {
  marginTop: 14,
  background:
    "linear-gradient(135deg, rgba(28,28,36,0.98) 0%, rgba(10,10,13,0.98) 100%)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 20,
  padding: 18,
};

const profileStatsStyle: CSSProperties = {
  display: "flex",
  gap: 18,
  marginTop: 14,
  color: "#dfe5ff",
  flexWrap: "wrap",
};

const miniTabsRowStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  marginTop: 18,
  flexWrap: "wrap",
};

const profileListItemStyle: CSSProperties = {
  padding: "12px 0",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
};

const sectionTitleStyle: CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
  marginBottom: 10,
};

const emptyStateStyle: CSSProperties = {
  color: "#9ca5c7",
  padding: "10px 0",
};

const smallMetaStyle: CSSProperties = {
  marginTop: 6,
  fontSize: 12,
  color: "#aeb6d4",
  lineHeight: 1.4,
};

const followingRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const smallActionButtonStyle = (active: boolean): CSSProperties => ({
  marginTop: 10,
  background: active ? "white" : "rgba(255,255,255,0.04)",
  color: active ? "black" : "white",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 12,
  padding: "8px 12px",
  cursor: "pointer",
  fontWeight: 800,
});

const navStyle: CSSProperties = {
  height: BOTTOM_NAV_HEIGHT,
  background: "rgba(0,0,0,0.9)",
  borderTop: "1px solid rgba(255,255,255,0.08)",
  backdropFilter: "blur(12px)",
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr",
  position: "fixed",
  bottom: 0,
  left: 0,
  right: 0,
};

const modalBackdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.76)",
  zIndex: 50,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};

const modalCardStyle: CSSProperties = {
  width: "100%",
  maxWidth: 700,
  maxHeight: "85vh",
  overflowY: "auto",
  background: "rgba(12,12,15,0.98)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 22,
  padding: 18,
};

const modalHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const closeButtonStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  color: "white",
  fontSize: 20,
  cursor: "pointer",
};

const modalPostCaptionStyle: CSSProperties = {
  marginTop: 10,
  color: "#d5dbf6",
};

const commentsWrapStyle: CSSProperties = {
  marginTop: 14,
  display: "grid",
  gap: 12,
};

const commentCardStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  padding: 12,
  background: "rgba(255,255,255,0.03)",
};

const commentHeaderStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  flexWrap: "wrap",
};

const authorBadgeStyle: CSSProperties = {
  background: "rgba(255,255,255,0.1)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 999,
  padding: "2px 8px",
  fontSize: 11,
  fontWeight: 800,
};

const repliesWrapStyle: CSSProperties = {
  marginTop: 12,
  display: "grid",
  gap: 8,
  paddingLeft: 14,
  borderLeft: "2px solid rgba(255,255,255,0.08)",
};

const replyCardStyle: CSSProperties = {
  padding: 10,
  borderRadius: 12,
  background: "rgba(255,255,255,0.03)",
};

const inlineTextButtonStyle: CSSProperties = {
  marginTop: 8,
  background: "transparent",
  border: "none",
  color: "#9dc7ff",
  cursor: "pointer",
  padding: 0,
};

const smallSolidButtonStyle: CSSProperties = {
  marginTop: 10,
  background: "white",
  color: "black",
  border: "none",
  borderRadius: 12,
  padding: "10px 14px",
  cursor: "pointer",
  fontWeight: 800,
};

function navButtonStyle(active: boolean): CSSProperties {
  return {
    background: "transparent",
    border: "none",
    color: active ? "white" : "#8f97b9",
    fontWeight: active ? 800 : 600,
    cursor: "pointer",
    fontSize: 14,
  };
}

function sectionTabButtonStyle(active: boolean): CSSProperties {
  return {
    background: active ? "white" : "rgba(255,255,255,0.05)",
    color: active ? "black" : "white",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 999,
    padding: "9px 13px",
    cursor: "pointer",
    fontWeight: 800,
    whiteSpace: "nowrap",
  };
}

function miniTabStyle(active: boolean): CSSProperties {
  return {
    background: active ? "white" : "rgba(255,255,255,0.05)",
    color: active ? "black" : "white",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 999,
    padding: "9px 13px",
    cursor: "pointer",
    fontWeight: 800,
  };
}

function primaryButtonStyle(disabled: boolean): CSSProperties {
  return {
    marginTop: 20,
    width: "100%",
    padding: "15px 16px",
    borderRadius: 14,
    border: "none",
    background: disabled ? "#39405b" : "white",
    color: disabled ? "#979fbd" : "black",
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

function reactionButtonStyle(active: boolean): CSSProperties {
  return {
    background: active ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.42)",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "white",
    fontSize: 22,
    cursor: "pointer",
    borderRadius: 16,
    padding: "8px 10px",
    backdropFilter: "blur(12px)",
  };
}

function followButtonStyle(active: boolean): CSSProperties {
  return {
    background: active ? "rgba(255,255,255,0.12)" : "white",
    color: active ? "white" : "black",
    border: active ? "1px solid rgba(255,255,255,0.12)" : "none",
    borderRadius: 999,
    padding: "7px 12px",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 12,
  };
}
