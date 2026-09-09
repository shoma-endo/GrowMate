import { Suspense } from 'react';
import BusinessInfoForm from './components/BusinessInfoForm';
import BusinessInfoFormSkeleton from './components/BusinessInfoFormSkeleton';

export const dynamic = 'force-dynamic';

export default function BusinessInfoPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6 text-center">事業者情報</h1>
      <Suspense fallback={<BusinessInfoFormSkeleton />}>
        <BusinessInfoForm />
      </Suspense>
    </div>
  );
}
