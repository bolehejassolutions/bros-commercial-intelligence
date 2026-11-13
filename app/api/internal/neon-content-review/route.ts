import {handleContentReviewRead} from '@/lib/portfolio/content-review-runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const revalidate=0;
export const GET=handleContentReviewRead;
export const HEAD=handleContentReviewRead;
