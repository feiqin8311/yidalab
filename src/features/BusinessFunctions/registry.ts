import { BarChart3Icon, FileSpreadsheetIcon, type LucideIcon } from 'lucide-react';

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

/** Extensible catalog — only enabled entries render on the center grid. */
export const BUSINESS_FUNCTIONS: BusinessFunctionDef[] = [
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
