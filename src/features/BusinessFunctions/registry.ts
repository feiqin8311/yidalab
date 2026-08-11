import { OPERATIONS_FUNCTIONS } from '@lobechat/utils';
import {
  ActivityIcon,
  BarChart3Icon,
  EyeIcon,
  FileSpreadsheetIcon,
  type LucideIcon,
  MegaphoneIcon,
  MessageSquareTextIcon,
  SearchIcon,
  SparklesIcon,
  StoreIcon,
} from 'lucide-react';

import type { DefaultResources } from '@/types/locale';

type CommonKey = keyof DefaultResources['common'];

export type BusinessFunctionDef = {
  descriptionKey: CommonKey;
  enabled: boolean;
  icon: LucideIcon;
  id: string;
  nameKey: CommonKey;
  path: string;
};

const OPS_ICONS: Record<string, LucideIcon> = {
  'asin-promo-rhythm': ActivityIcon,
  'asin-traffic-diagnosis': SearchIcon,
  'brand-research': StoreIcon,
  'category-opportunity': SparklesIcon,
  'competitor-visual': EyeIcon,
  'listing-optimization': MegaphoneIcon,
  'review-voc': MessageSquareTextIcon,
};

const OPS_NAME_KEYS: Record<string, CommonKey> = {
  'asin-promo-rhythm': 'businessFunctions.ops.asinPromoRhythm.name',
  'asin-traffic-diagnosis': 'businessFunctions.ops.asinTraffic.name',
  'brand-research': 'businessFunctions.ops.brandResearch.name',
  'category-opportunity': 'businessFunctions.ops.categoryOpportunity.name',
  'competitor-visual': 'businessFunctions.ops.competitorVisual.name',
  'listing-optimization': 'businessFunctions.ops.listingOptimization.name',
  'review-voc': 'businessFunctions.ops.reviewVoc.name',
};

const OPS_DESC_KEYS: Record<string, CommonKey> = {
  'asin-promo-rhythm': 'businessFunctions.ops.asinPromoRhythm.description',
  'asin-traffic-diagnosis': 'businessFunctions.ops.asinTraffic.description',
  'brand-research': 'businessFunctions.ops.brandResearch.description',
  'category-opportunity': 'businessFunctions.ops.categoryOpportunity.description',
  'competitor-visual': 'businessFunctions.ops.competitorVisual.description',
  'listing-optimization': 'businessFunctions.ops.listingOptimization.description',
  'review-voc': 'businessFunctions.ops.reviewVoc.description',
};

/** Extensible catalog — only enabled entries render on the center grid. */
export const BUSINESS_FUNCTIONS: BusinessFunctionDef[] = [
  ...OPERATIONS_FUNCTIONS.map((fn) => ({
    descriptionKey: OPS_DESC_KEYS[fn.id] ?? ('businessFunctions.centerDesc' as CommonKey),
    enabled: true,
    icon: OPS_ICONS[fn.id] ?? BarChart3Icon,
    id: fn.id,
    nameKey: OPS_NAME_KEYS[fn.id] ?? ('businessFunctions.centerTitle' as CommonKey),
    path: fn.path,
  })),
  {
    descriptionKey: 'businessFunctions.lingxingAds.description',
    enabled: true,
    icon: BarChart3Icon,
    id: 'lingxing-ads',
    nameKey: 'businessFunctions.lingxingAds.name',
    path: '/functions/lingxing-ads',
  },
  {
    descriptionKey: 'businessFunctions.amazonKw.description',
    enabled: true,
    icon: FileSpreadsheetIcon,
    id: 'amazon-old-product-keyword-analysis',
    nameKey: 'businessFunctions.amazonKw.name',
    path: '/functions/amazon-old-product-keyword-analysis',
  },
];

export const getEnabledBusinessFunctions = () => BUSINESS_FUNCTIONS.filter((item) => item.enabled);

export const getBusinessFunctionById = (id: string) =>
  BUSINESS_FUNCTIONS.find((item) => item.id === id);
