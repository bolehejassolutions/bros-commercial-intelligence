import {headers} from 'next/headers';
import {notFound,redirect} from 'next/navigation';
import {isNeonPreviewEnabled} from '@/lib/bci/neon-preview-handler';
import {BCI_NEON_PREVIEW_CANONICAL_ORIGIN} from '@/lib/bci/neon-preview-canonical-origin';
import ContentReview from './review-client';
import './studio.css';
export const dynamic='force-dynamic';
export const revalidate=0;
export const metadata={robots:{index:false,follow:false},title:'BROS CONTENT — Semakan kandungan'};
export default async function ContentReviewPage(){
  if(!isNeonPreviewEnabled(process.env))notFound();
  if((await headers()).get('host')!==new URL(BCI_NEON_PREVIEW_CANONICAL_ORIGIN).host)
    redirect(BCI_NEON_PREVIEW_CANONICAL_ORIGIN+'/internal/neon-preview/content-review');
  return <ContentReview/>;
}
