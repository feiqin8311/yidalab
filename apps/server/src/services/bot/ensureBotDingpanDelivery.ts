/**
 * @deprecated Prefer prepareBotOutboundReply — kept as thin alias for any leftover imports.
 */
export {
  appendBotDingpanPreviewLink,
  scrubFakeUploadProgressNarration,
  shouldEnsureDingpanForBotReply,
  wrapBotReplyAsHtml,
} from './botDingpanDeliveryHeuristic';
export { prepareBotOutboundReply as ensureBotDingpanDelivery } from './prepareBotOutboundReply';
