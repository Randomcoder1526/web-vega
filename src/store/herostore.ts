import { create } from 'zustand';
import type { Post } from '../types';

interface Hero {
  hero: Post;
  setHero: (hero: Post) => void;
}

export const useHeroStore = create<Hero>((set) => ({
  hero: { title: '', link: '', image: '' },
  setHero: (hero) => set({ hero }),
}));
