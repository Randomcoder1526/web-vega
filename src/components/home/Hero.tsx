import React from "react";
import { LuPlay as Play } from "react-icons/lu";
import { useHeroMetadata } from "../../lib/hooks/useHomePageData";
import { prefetchArtworkPalette, useArtworkPalette } from "../../lib/hooks/useArtworkPalette";
import { useNavigate } from "react-router-dom";
import useContentStore from "../../lib/zustand/contentStore";
import { useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { settingsStorage } from "../../lib/storage";
import { Skeleton } from "../ui/skeleton";
import "./Hero.css";

interface HeroProps {
  post: {
    title: string;
    image: string;
    link: string;
  } | null;
}

export const Hero: React.FC<HeroProps> = ({ post }) => {
  const navigate = useNavigate();
  const { provider } = useContentStore();
  const tvMode = settingsStorage.isTvModeEnabled();

  const { data: meta, isLoading: metaLoading } = useHeroMetadata(
    post?.link || "",
    provider?.value || "",
  );
  const heroArtwork = meta?.background || meta?.image || post?.image;
  const artworkPaletteStyle = useArtworkPalette(heroArtwork);
  const heroButtonStyle = {
    "--primary": "#ffffff",
    "--on-primary": "#171717",
    ...artworkPaletteStyle,
  } as React.CSSProperties;

  React.useEffect(() => {
    if (post?.image && settingsStorage.isInfoPageDynamicThemeEnabled()) {
      void prefetchArtworkPalette(post.image);
    }
  }, [post?.image]);

  const handlePlayClick = () => {
    if (post) {
      const params = new URLSearchParams();
      if (provider?.value) params.set("provider", provider.value);
      if (post.image) params.set("poster", post.image);
      navigate(`/content/${encodeURIComponent(post.link)}?${params.toString()}`);
    }
  };

  if (!post || metaLoading) {
    return (
      <div className="hero-container skeleton">
        {post ? (
          <div
            className="hero-background"
            style={{ backgroundImage: `url(${post.image})` }}
          />
        ) : (
          <Skeleton className="hero-skeleton-bg" />
        )}
        <div className="hero-vignette" />
        <div className="hero-content">
          <Skeleton className="hero-skeleton-title" />
          <Skeleton className="hero-skeleton-copy hero-skeleton-copy-wide" />
          <Skeleton className="hero-skeleton-copy" />
          <Skeleton className="hero-skeleton-button" />
        </div>
      </div>
    );
  }

  // Prefer enriched artwork when requested, then provider metadata and the post.
  const bgImage = meta?.background || meta?.image || post.image;
  // Use logo if available, otherwise just text
  const logoUrl = meta?.logo;
  const displayTitle = meta?.name || meta?.title || post.title;
  const description = meta?.description || meta?.plot || meta?.synopsis || "";

  return (
    <div className="hero-container">
      <div
        className="hero-background"
        style={{ backgroundImage: `url(${bgImage})` }}
      />
      <div className="hero-vignette" />

      <div className="hero-content">
        {logoUrl ? (
          <img src={logoUrl} alt={displayTitle} className="hero-logo" />
        ) : (
          <h1 className="hero-title display-lg">{displayTitle}</h1>
        )}

        {description && (
          <p className="hero-description body-lg">{description}</p>
        )}

        <div className="hero-actions">
          <HeroPlayButton
            tvMode={tvMode}
            style={heroButtonStyle}
            onClick={handlePlayClick}
          />
        </div>
      </div>
    </div>
  );
};


const HeroPlayButton: React.FC<{
  tvMode: boolean;
  style: React.CSSProperties;
  onClick: () => void;
}> = ({ tvMode, style, onClick }) => {
  const { ref, focused } = useFocusable({
    focusable: tvMode,
    onEnterPress: onClick,
    onFocus: (layout) => {
      layout.node.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
  });

  return (
    <button
      ref={ref}
      className={`btn-play ${focused ? "tv-focus" : ""}`}
      style={style}
      onClick={onClick}
    >
      <Play size={24} fill="currentColor" />
      <span className="label-lg">Play</span>
    </button>
  );
};
