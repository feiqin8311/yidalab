import { DingpanApiName, DingpanIdentifier } from '@lobechat/builtin-tool-dingpan';
import type { BuiltinPortal, BuiltinPortalTitle, BuiltinRender } from '@lobechat/types';

import DingpanPortal from './Portal';
import DingpanPortalTitle from './PortalTitle';
import UploadHtmlRender from './UploadHtmlRender';

export { DingpanIdentifier };

export const DingpanRenders: Record<string, BuiltinRender> = {
  [DingpanApiName.uploadHtmlToDingpan]: UploadHtmlRender as BuiltinRender,
};

export const DingpanPortalView = DingpanPortal as BuiltinPortal;
export const DingpanPortalTitleView = DingpanPortalTitle as BuiltinPortalTitle;
