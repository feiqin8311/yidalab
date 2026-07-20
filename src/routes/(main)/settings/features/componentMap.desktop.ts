import Billing from '@/business/client/BusinessSettingPages/Billing';
import Credits from '@/business/client/BusinessSettingPages/Credits';
import Notification from '@/business/client/BusinessSettingPages/Notification';
import Plans from '@/business/client/BusinessSettingPages/Plans';
import Referral from '@/business/client/BusinessSettingPages/Referral';
import Usage from '@/business/client/BusinessSettingPages/Usage';
import { SettingsTabs } from '@/store/global/initialState';

import Advanced from '../advanced';
import APIKey from '../apikey';
import Appearance from '../appearance';
import Company from '../company';
import Connector from '../connector';
import Devices from '../devices';
import Hotkey from '../hotkey';
import Memory from '../memory';
import Profile from '../profile';
import Provider from '../provider';
import Proxy from '../proxy';
import Security from '../security';
import ServiceModel from '../service-model';
import Skill from '../skill';
import Stats from '../stats';
import Storage from '../storage';
import SystemTools from '../system-tools';

export const componentMap = {
  [SettingsTabs.Advanced]: Advanced,
  [SettingsTabs.Appearance]: Appearance,
  [SettingsTabs.Provider]: Provider,
  [SettingsTabs.ServiceModel]: ServiceModel,
  [SettingsTabs.Memory]: Memory,
  [SettingsTabs.Notification]: Notification,
  [SettingsTabs.Hotkey]: Hotkey,
  [SettingsTabs.Proxy]: Proxy,
  [SettingsTabs.SystemTools]: SystemTools,
  [SettingsTabs.Storage]: Storage,
  [SettingsTabs.Devices]: Devices,
  // Profile related tabs
  [SettingsTabs.Profile]: Profile,
  [SettingsTabs.Stats]: Stats,
  [SettingsTabs.Usage]: Usage,
  [SettingsTabs.APIKey]: APIKey,
  [SettingsTabs.Security]: Security,
  [SettingsTabs.Skill]: Skill,
  [SettingsTabs.Connector]: Connector,
  [SettingsTabs.Company]: Company,

  [SettingsTabs.Plans]: Plans,
  [SettingsTabs.Credits]: Credits,
  [SettingsTabs.Billing]: Billing,
  [SettingsTabs.Referral]: Referral,
};
