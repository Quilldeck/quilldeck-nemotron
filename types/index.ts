import { GenreCategory } from '../constants/genres';

export type BookFormat = 'ebook' | 'paperback' | 'hardback' | 'audiobook';

export const ALL_FORMATS: BookFormat[] = ['ebook', 'paperback', 'hardback', 'audiobook'];

export interface BookProject {
  id: string;
  title: string;
  genreCategory: GenreCategory;
  genre: string;
  synopsis: string;
  coverImageUri?: string;
  launchDate?: string;
  format: BookFormat[];
  createdAt: string;
}

export interface GeneratedBlurb {
  id: string;
  bookId: string;
  variant: number;
  text: string;
  hook: string;
  createdAt: string;
}

export interface MarketingPackage {
  id: string;
  bookId: string;
  socialPosts: SocialPost[];
  emails: EmailDraft[];
  adCopy: AdCopyVariant[];
  calendar: CalendarDay[];
  promoSites: PromoSite[];
  createdAt: string;
}

export interface SocialPost {
  platform: 'booktok' | 'bookstagram' | 'x' | 'facebook' | 'general';
  content: string;
  hashtags: string[];
  postType: string;
}

export interface EmailDraft {
  type: 'pre-launch' | 'launch-day' | 'follow-up';
  subjectLine: string;
  subjectLineAlt: string;
  body: string;
}

export interface AdCopyVariant {
  headline: string;
  body: string;
  keywords: string[];
}

export interface CalendarDay {
  day: number;
  date: string;
  platform: string;
  postType: string;
  content: string;
}

export interface PromoSite {
  name: string;
  url: string;
  cost: string;
  genre: string;
  notes: string;
  formats?: BookFormat[];
}

export interface SubscriptionState {
  tier: 'free' | 'pro';
  blurbsUsed: number;
  marketingUsed: number;
  walletAddress?: string;
  txSignature?: string;
  expiresAt?: string;
}