import { type ImageGenerationTopic } from '@/types/generation';

export type GenerationTopicVisibility = NonNullable<ImageGenerationTopic['visibility']>;

export interface GenerationTopicState {
  activeGenerationTopicId: string | null;
  generationTopics: ImageGenerationTopic[];
  loadingGenerationTopicIds: string[];
  newGenerationTopicVisibility: GenerationTopicVisibility;
}

export const initialGenerationTopicState: GenerationTopicState = {
  activeGenerationTopicId:
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('topic') : null,
  generationTopics: [],
  loadingGenerationTopicIds: [],
  // Video generation is personal per member; do not default-share to the company.
  newGenerationTopicVisibility: 'private',
};
