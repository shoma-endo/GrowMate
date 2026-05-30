import { EvaluationControls } from './evaluation-controls';
import { NegativeKeywordsSuggestionSettings } from './NegativeKeywordsSuggestionSettings';
import type { GoogleAdsEvaluationSettings } from '@/types/google-ads-evaluation';

interface GoogleAdsMailSettingsPanelProps {
  hasEmailAddress: boolean;
  hasGoogleAdsReady: boolean;
  initialSettings: GoogleAdsEvaluationSettings;
}

export function GoogleAdsMailSettingsPanel({
  hasEmailAddress,
  hasGoogleAdsReady,
  initialSettings,
}: GoogleAdsMailSettingsPanelProps) {
  return (
    <div className="space-y-6">
      <EvaluationControls
        hasEmailAddress={hasEmailAddress}
        initialSettings={initialSettings}
      />
      <NegativeKeywordsSuggestionSettings
        hasEmailAddress={hasEmailAddress}
        hasGoogleAdsReady={hasGoogleAdsReady}
      />
    </div>
  );
}
