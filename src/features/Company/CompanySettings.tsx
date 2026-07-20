'use client';

import { Alert, Avatar, Flexbox, FormGroup, Input, Text } from '@lobehub/ui';
import { Button, confirmModal, Select, Tabs, toast } from '@lobehub/ui/base-ui';
import { Form } from 'antd';
import {
  ArrowLeftIcon,
  Building2Icon,
  ChevronRightIcon,
  FolderIcon,
  LogOutIcon,
  SendIcon,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useWorkspaceState } from '@/business/client/workspaceState';
import ImperativeModal from '@/components/ImperativeModal';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';
import { companyService } from '@/services/company';
import { useUserStore } from '@/store/user';

import {
  refreshCompany,
  useCompanyDepartments,
  useCompanyInvitations,
  useCompanyMembers,
  useMyCompany,
} from './hooks';

interface CompanyDepartment {
  id: string;
  name: string;
}

interface CompanyMember {
  avatar: string | null;
  departmentId: string | null;
  departmentName: string | null;
  email: string | null;
  position: string | null;
  role: 'admin' | 'editor' | 'member' | 'owner' | 'viewer';
  userId: string;
  username: string | null;
}

interface CompanyInvitation {
  departmentName: string | null;
  email: string | null;
  id: string;
  position: string | null;
  role: 'admin' | 'editor' | 'member' | 'owner' | 'viewer';
  status: string;
}

const ErrorState = ({ onRetry }: { onRetry: () => void }) => {
  const { t } = useTranslation('auth');
  return <Alert action={<Button onClick={onRetry}>{t('company.retry')}</Button>} type={'error'} />;
};

const getInvitationToken = (value: string) =>
  new URL(value.trim(), 'https://placeholder.local').pathname.split('/').findLast(Boolean);

const memberRoleValue = (role: CompanyMember['role']) =>
  role === 'admin' || role === 'owner' ? 'admin' : 'member';

const CreateCompany = () => {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const logout = useUserStore((state) => state.logout);
  const [form] = Form.useForm<{ departmentName: string; name: string; position: string }>();
  const [inviteValue, setInviteValue] = useState('');
  const [saving, setSaving] = useState(false);

  const onFinish = async (values: { departmentName: string; name: string; position: string }) => {
    try {
      setSaving(true);
      const created = await companyService.create(values);
      await refreshCompany();
      useWorkspaceState.getState().setActiveWorkspaceId(created.workspace.id);
      navigate(`/${created.workspace.slug}`);
    } finally {
      setSaving(false);
    }
  };

  const joinCompany = () => {
    const token = getInvitationToken(inviteValue);
    if (!token) return;
    navigate(`/company/invite/${token}`);
  };

  return (
    <FormGroup collapsible={false} gap={16} title={t('company.create.title')} variant={'filled'}>
      <Text type={'secondary'}>{t('company.create.description')}</Text>
      <Form form={form} layout={'vertical'} onFinish={onFinish}>
        <Form.Item label={t('company.name')} name={'name'} rules={[{ required: true }]}>
          <Input placeholder={t('company.namePlaceholder')} />
        </Form.Item>
        <Form.Item
          label={t('company.department')}
          name={'departmentName'}
          rules={[{ required: true }]}
        >
          <Input placeholder={t('company.departmentPlaceholder')} />
        </Form.Item>
        <Form.Item label={t('profile.position')} name={'position'} rules={[{ required: true }]}>
          <Input placeholder={t('company.positionPlaceholder')} />
        </Form.Item>
        <Button htmlType={'submit'} loading={saving} type={'primary'}>
          {t('company.create.action')}
        </Button>
      </Form>
      <Flexbox gap={8}>
        <Text type={'secondary'}>{t('company.join.description')}</Text>
        <Flexbox horizontal gap={8}>
          <Input
            placeholder={t('company.join.placeholder')}
            value={inviteValue}
            onChange={(event) => setInviteValue(event.target.value)}
          />
          <Button disabled={!inviteValue.trim()} onClick={joinCompany}>
            {t('company.join.action')}
          </Button>
        </Flexbox>
        <Button icon={LogOutIcon} type={'text'} onClick={() => logout()}>
          {t('company.logout')}
        </Button>
      </Flexbox>
    </FormGroup>
  );
};

const Members = ({
  canManage,
  departments,
  isOwner,
  workspaceId,
}: {
  canManage: boolean;
  departments: CompanyDepartment[];
  isOwner: boolean;
  workspaceId: string;
}) => {
  const { t } = useTranslation('auth');
  const { data, error, isLoading, mutate } = useCompanyMembers(workspaceId);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | null>(null);
  const [hoveredDeptId, setHoveredDeptId] = useState<string | null>(null);
  const [newDeptName, setNewDeptName] = useState('');
  const [savingDept, setSavingDept] = useState(false);
  const [deletingDeptId, setDeletingDeptId] = useState<string | null>(null);

  if (error) return <ErrorState onRetry={() => void mutate()} />;
  if (isLoading) return <Text>{t('company.loading')}</Text>;

  const createDepartment = async () => {
    if (!newDeptName.trim()) return;
    try {
      setSavingDept(true);
      await companyService.createDepartment({ name: newDeptName.trim(), workspaceId });
      setNewDeptName('');
      await refreshCompany(workspaceId);
    } finally {
      setSavingDept(false);
    }
  };

  // Filter members by selected department
  const filteredMembers = (data ?? []).filter((member) => {
    if (selectedDepartmentId === 'unassigned') {
      return !member.departmentId;
    }
    return member.departmentId === selectedDepartmentId;
  });

  if (selectedDepartmentId !== null) {
    const activeDeptName =
      selectedDepartmentId === 'unassigned'
        ? t('company.unassigned', { defaultValue: '未分配部门' })
        : departments.find((d) => d.id === selectedDepartmentId)?.name || '';

    return (
      <Flexbox gap={12}>
        <Flexbox horizontal align="center" gap={8} style={{ marginBottom: 4 }}>
          <Button
            icon={<ArrowLeftIcon size={16} />}
            style={{ paddingLeft: 0 }}
            type="text"
            onClick={() => setSelectedDepartmentId(null)}
          >
            {t('common:back', { defaultValue: '返回' })}
          </Button>
          <Text strong style={{ fontSize: 15 }}>
            {activeDeptName}
          </Text>
        </Flexbox>
        {filteredMembers.length === 0 ? (
          <Text style={{ padding: '8px 12px' }} type="secondary">
            {t('common:empty', { defaultValue: '暂无成员' })}
          </Text>
        ) : (
          filteredMembers.map((member: CompanyMember) => (
            <MemberRow
              canManage={canManage}
              departments={departments}
              isOwner={isOwner}
              key={member.userId}
              member={member}
              workspaceId={workspaceId}
            />
          ))
        )}
      </Flexbox>
    );
  }

  // Otherwise show departments list
  const unassignedCount = (data ?? []).filter((member) => !member.departmentId).length;

  return (
    <Flexbox gap={12}>
      {canManage && (
        <Flexbox horizontal gap={8} style={{ marginBottom: 8 }}>
          <Input
            placeholder={t('company.departmentPlaceholder')}
            value={newDeptName}
            onChange={(event) => setNewDeptName(event.target.value)}
          />
          <Button loading={savingDept} onClick={createDepartment}>
            {t('company.departmentAdd')}
          </Button>
        </Flexbox>
      )}

      {departments.map((department: CompanyDepartment) => {
        const memberCount = (data ?? []).filter((m) => m.departmentId === department.id).length;
        return (
          <Flexbox
            horizontal
            align={'center'}
            justify={'space-between'}
            key={department.id}
            style={{
              padding: '14px 20px',
              borderRadius: 8,
              background:
                hoveredDeptId === department.id
                  ? 'var(--color-bg-text-hover, rgba(0, 0, 0, 0.02))'
                  : 'var(--color-bg-container, #ffffff)',
              border: '1px solid var(--color-border-secondary, #f0f0f0)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            onClick={() => setSelectedDepartmentId(department.id)}
            onMouseEnter={() => setHoveredDeptId(department.id)}
            onMouseLeave={() => setHoveredDeptId(null)}
          >
            <Flexbox horizontal align={'center'} gap={12}>
              <FolderIcon color="var(--color-primary, #1890ff)" size={20} />
              <Text style={{ fontSize: 15, fontWeight: 500 }}>
                {department.name}
                <span
                  style={{
                    marginLeft: 8,
                    color: 'var(--color-text-description, #8c8c8c)',
                    fontSize: 13,
                    fontWeight: 400,
                  }}
                >
                  {t('company.memberCount', {
                    count: memberCount,
                    defaultValue: `(${memberCount}人)`,
                  })}
                </span>
              </Text>
            </Flexbox>
            <Flexbox horizontal align="center" gap={8} onClick={(e) => e.stopPropagation()}>
              {canManage && (
                <Button
                  danger
                  loading={deletingDeptId === department.id}
                  size={'small'}
                  type={'text'}
                  onClick={async (e) => {
                    e.stopPropagation();
                    setDeletingDeptId(department.id);
                    try {
                      await companyService.deleteDepartment({
                        departmentId: department.id,
                        workspaceId,
                      });
                      await refreshCompany(workspaceId);
                    } finally {
                      setDeletingDeptId(null);
                    }
                  }}
                >
                  {t('company.delete')}
                </Button>
              )}
              <ChevronRightIcon color="var(--color-text-description, #8c8c8c)" size={18} />
            </Flexbox>
          </Flexbox>
        );
      })}

      {unassignedCount > 0 && (
        <Flexbox
          horizontal
          align={'center'}
          justify={'space-between'}
          style={{
            padding: '14px 20px',
            borderRadius: 8,
            background:
              hoveredDeptId === 'unassigned'
                ? 'var(--color-bg-text-hover, rgba(0, 0, 0, 0.02))'
                : 'var(--color-bg-container, #ffffff)',
            border: '1px solid var(--color-border-secondary, #f0f0f0)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
          onClick={() => setSelectedDepartmentId('unassigned')}
          onMouseEnter={() => setHoveredDeptId('unassigned')}
          onMouseLeave={() => setHoveredDeptId(null)}
        >
          <Flexbox horizontal align={'center'} gap={12}>
            <FolderIcon color="var(--color-text-description, #8c8c8c)" size={20} />
            <Text style={{ fontSize: 15, fontWeight: 500 }}>
              {t('company.unassigned', { defaultValue: '未分配部门' })}
              <span
                style={{
                  marginLeft: 8,
                  color: 'var(--color-text-description, #8c8c8c)',
                  fontSize: 13,
                  fontWeight: 400,
                }}
              >
                {t('company.memberCount', {
                  count: unassignedCount,
                  defaultValue: `(${unassignedCount}人)`,
                })}
              </span>
            </Text>
          </Flexbox>
          <ChevronRightIcon color="var(--color-text-description, #8c8c8c)" size={18} />
        </Flexbox>
      )}
    </Flexbox>
  );
};

const MemberRow = ({
  canManage,
  departments,
  isOwner,
  member,
  workspaceId,
}: {
  canManage: boolean;
  departments: CompanyDepartment[];
  isOwner: boolean;
  member: CompanyMember;
  workspaceId: string;
}) => {
  const { t } = useTranslation('auth');
  const [form] = Form.useForm<{
    departmentId: string;
    position: string;
    role: 'admin' | 'member';
  }>();
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [hovered, setHovered] = useState(false);

  const editable = canManage && member.role !== 'owner' && (isOwner || member.role === 'member');
  const roleEditable = isOwner && member.role !== 'owner';

  const save = async (values: {
    departmentId: string;
    position: string;
    role: 'admin' | 'member';
  }) => {
    try {
      setSaving(true);
      await companyService.updateMember({ ...values, userId: member.userId, workspaceId });
      await refreshCompany(workspaceId);
      setModalOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Flexbox
        horizontal
        align={'center'}
        justify={'space-between'}
        style={{
          padding: '16px 20px',
          borderRadius: 8,
          background:
            hovered && editable
              ? 'var(--color-bg-text-hover, rgba(0, 0, 0, 0.02))'
              : 'var(--color-bg-container, #ffffff)',
          border: '1px solid var(--color-border-secondary, #f0f0f0)',
          cursor: editable ? 'pointer' : 'default',
          transition: 'all 0.2s ease',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => {
          if (editable) {
            setModalOpen(true);
          }
        }}
      >
        <Flexbox horizontal align={'center'} gap={16}>
          <Avatar
            avatar={member.avatar || member.username || member.email || '👤'}
            size={44}
            style={{ borderRadius: 8 }}
          />
          <Flexbox gap={6}>
            <Flexbox horizontal align={'center'} gap={8} wrap="wrap">
              <Text
                style={{ fontSize: 15, color: 'var(--color-text, rgba(0, 0, 0, 0.88))' }}
                weight={600}
              >
                {member.username || member.email}
              </Text>
            </Flexbox>

            <Text style={{ fontSize: 13 }} type={'secondary'}>
              {[member.departmentName, member.position].filter(Boolean).join(' · ') || '—'}
            </Text>
          </Flexbox>
        </Flexbox>
      </Flexbox>

      {editable && modalOpen && (
        <ImperativeModal
          destroyOnHidden
          confirmLoading={saving}
          open={modalOpen}
          title={`${t('company.manage', { defaultValue: 'Manage Member' })}: ${member.username || member.email}`}
          onCancel={() => setModalOpen(false)}
          onOk={() => form.submit()}
        >
          <Form
            form={form}
            layout={'vertical'}
            style={{ paddingTop: 16 }}
            initialValues={{
              departmentId: member.departmentId ?? undefined,
              position: member.position ?? '',
              role: memberRoleValue(member.role),
            }}
            onFinish={save}
          >
            <Form.Item
              label={t('company.department')}
              name={'departmentId'}
              rules={[{ required: true }]}
            >
              <Select
                options={departments.map((department) => ({
                  label: department.name,
                  value: department.id,
                }))}
              />
            </Form.Item>
            <Form.Item label={t('profile.position')} name={'position'} rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item label={t('company.role')} name={'role'} rules={[{ required: true }]}>
              <Select
                disabled={!roleEditable}
                options={[
                  { label: t('company.role.member'), value: 'member' },
                  { label: t('company.role.admin'), value: 'admin' },
                ]}
              />
            </Form.Item>
          </Form>
        </ImperativeModal>
      )}
    </>
  );
};

const Invitations = ({
  departments,
  workspaceId,
}: {
  departments: CompanyDepartment[];
  workspaceId: string;
}) => {
  const { t } = useTranslation('auth');
  const { data, error, isLoading, mutate } = useCompanyInvitations(workspaceId);
  const [form] = Form.useForm<{
    departmentId: string;
    email: string;
    position: string;
    role: 'admin' | 'member';
  }>();
  const [saving, setSaving] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  if (error) return <ErrorState onRetry={() => void mutate()} />;
  if (isLoading) return <Text>{t('company.loading')}</Text>;

  const send = async (values: {
    departmentId: string;
    email: string;
    position: string;
    role: 'admin' | 'member';
  }) => {
    try {
      setSaving(true);
      setSendError(null);
      await companyService.sendInvitation({ ...values, workspaceId });
      form.resetFields();
      await refreshCompany(workspaceId);
    } catch (error) {
      console.error('[company:sendInvitation]', error);
      setSendError(t('company.invite.failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Flexbox gap={16}>
      {sendError && <Alert message={sendError} type={'error'} />}
      <Form form={form} layout={'vertical'} onFinish={send}>
        <Form.Item
          label={t('profile.email')}
          name={'email'}
          rules={[{ required: true, type: 'email' }]}
        >
          <Input placeholder={t('company.invite.emailPlaceholder')} />
        </Form.Item>
        <Form.Item
          label={t('company.department')}
          name={'departmentId'}
          rules={[{ required: true }]}
        >
          <Select
            options={departments.map((department) => ({
              label: department.name,
              value: department.id,
            }))}
          />
        </Form.Item>
        <Form.Item label={t('profile.position')} name={'position'} rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item initialValue={'member'} label={t('company.role')} name={'role'}>
          <Select
            options={[
              { label: t('company.role.member'), value: 'member' },
              { label: t('company.role.admin'), value: 'admin' },
            ]}
          />
        </Form.Item>
        <Button htmlType={'submit'} icon={SendIcon} loading={saving} type={'primary'}>
          {t('company.invite.action')}
        </Button>
      </Form>
      {(data ?? []).map((invitation: CompanyInvitation) => (
        <Flexbox horizontal align={'center'} justify={'space-between'} key={invitation.id}>
          <Text>{invitation.email}</Text>
          <Text type={'secondary'}>{invitation.status}</Text>
          {invitation.status === 'pending' && (
            <Flexbox horizontal gap={4}>
              <Button
                size={'small'}
                type={'text'}
                onClick={async () => {
                  await companyService.resendInvitation({
                    invitationId: invitation.id,
                    workspaceId,
                  });
                  await refreshCompany(workspaceId);
                }}
              >
                {t('company.invite.resend')}
              </Button>
              <Button
                danger
                size={'small'}
                type={'text'}
                onClick={async () => {
                  await companyService.revokeInvitation({
                    invitationId: invitation.id,
                    workspaceId,
                  });
                  await refreshCompany(workspaceId);
                }}
              >
                {t('company.invite.revoke')}
              </Button>
            </Flexbox>
          )}
        </Flexbox>
      ))}
    </Flexbox>
  );
};

const OrganizationChart = ({
  departments,
  workspaceId,
}: {
  departments: CompanyDepartment[];
  workspaceId: string;
}) => {
  const { t } = useTranslation('auth');
  const { data: members = [] } = useCompanyMembers(workspaceId);
  const unassignedMembers = members.filter((member) => !member.departmentId);

  return (
    <FormGroup collapsible={false} title={t('company.organization')} variant={'filled'}>
      <Flexbox gap={12}>
        {departments.map((department) => (
          <Flexbox gap={4} key={department.id}>
            <Text weight={600}>{department.name}</Text>
            {members
              .filter((member) => member.departmentId === department.id)
              .map((member) => (
                <Text key={member.userId} type={'secondary'}>
                  {member.username || member.username || member.email} · {member.position}
                </Text>
              ))}
          </Flexbox>
        ))}
        {unassignedMembers.length > 0 && (
          <Flexbox gap={4}>
            <Text weight={600}>{t('company.unassigned')}</Text>
            {unassignedMembers.map((member) => (
              <Text key={member.userId} type={'secondary'}>
                {member.username || member.username || member.email} · {member.position}
              </Text>
            ))}
          </Flexbox>
        )}
      </Flexbox>
    </FormGroup>
  );
};

const General = ({
  company,
}: {
  company: {
    creatorName: string | null;
    departmentName: string | null;
    id: string;
    name: string;
    position: string | null;
    role: string;
  };
}) => {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const { data: members = [] } = useCompanyMembers(company.id);
  const [name, setName] = useState(company.name);
  const [ownerId, setOwnerId] = useState<string>();
  const [saving, setSaving] = useState(false);
  const isOwner = company.role === 'owner';

  const transferOwnership = () => {
    if (!ownerId) return;
    confirmModal({
      cancelText: t('profile.cancel'),
      content: t('company.transfer.description'),
      okText: t('company.transfer.action'),
      title: t('company.transfer.title'),
      onOk: async () => {
        await companyService.transferOwnership({ userId: ownerId, workspaceId: company.id });
        await refreshCompany(company.id);
      },
    });
  };

  const deleteCompany = () => {
    confirmModal({
      cancelText: t('profile.cancel'),
      content: t('company.delete.description'),
      okText: t('company.delete.action'),
      title: t('company.delete.title'),
      onOk: async () => {
        await companyService.delete(company.id);
        useWorkspaceState.getState().setActiveWorkspaceId(null);
        await refreshCompany(company.id);
        navigate('/');
      },
    });
  };

  const leaveCompany = () => {
    confirmModal({
      cancelText: t('profile.cancel'),
      content: t('company.leave.description'),
      okText: t('company.leave.action'),
      title: t('company.leave.title'),
      onOk: () => {
        setSaving(true);
        void (async () => {
          try {
            await companyService.leave(company.id);
            useWorkspaceState.getState().setActiveWorkspaceId(null);
            await refreshCompany(company.id);
            navigate('/');
          } catch (error) {
            console.error('[company:leave]', error);
            toast.error(t('company.leave.failed'));
          } finally {
            setSaving(false);
          }
        })();
      },
    });
  };

  return (
    <Flexbox gap={16}>
      <FormGroup collapsible={false} title={t('company.tab.general')} variant={'filled'}>
        <Flexbox gap={8}>
          {isOwner ? (
            <Flexbox horizontal gap={8}>
              <Input value={name} onChange={(event) => setName(event.target.value)} />
              <Button
                disabled={!name.trim() || name.trim() === company.name}
                loading={saving}
                onClick={async () => {
                  try {
                    setSaving(true);
                    await companyService.updateCompany({
                      name: name.trim(),
                      workspaceId: company.id,
                    });
                    await refreshCompany(company.id);
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {t('profile.save')}
              </Button>
            </Flexbox>
          ) : (
            <Text>{company.name}</Text>
          )}
          <Flexbox horizontal align={'center'} gap={8}>
            <Text type={'secondary'}>{t('company.creator')}</Text>
            <Text>{company.creatorName || '-'}</Text>
          </Flexbox>
        </Flexbox>
      </FormGroup>
      {isOwner && (
        <FormGroup collapsible={false} title={t('company.transfer.title')} variant={'filled'}>
          <Flexbox horizontal gap={8}>
            <Select
              placeholder={t('company.transfer.placeholder')}
              value={ownerId}
              options={members
                .filter((member) => member.role !== 'owner')
                .map((member) => ({
                  label: member.username || member.username || member.email || member.userId,
                  value: member.userId,
                }))}
              onChange={setOwnerId}
            />
            <Button disabled={!ownerId} onClick={transferOwnership}>
              {t('company.transfer.action')}
            </Button>
          </Flexbox>
          <Button danger size={'small'} type={'text'} onClick={deleteCompany}>
            {t('company.delete.action')}
          </Button>
        </FormGroup>
      )}
      {!isOwner && (
        <FormGroup collapsible={false} title={t('company.leave.title')} variant={'filled'}>
          <Text type={'secondary'}>{t('company.leave.description')}</Text>
          <Button danger loading={saving} onClick={leaveCompany}>
            {t('company.leave.action')}
          </Button>
        </FormGroup>
      )}
    </Flexbox>
  );
};

type CompanySettingsTab = 'general' | 'invitations' | 'members' | 'organization';

interface CompanySettingsProps {
  headerTitle?: string;
  initialTab?: CompanySettingsTab;
  showTabs?: boolean;
  tabs?: CompanySettingsTab[];
}

const CompanySettings = ({
  headerTitle,
  initialTab = 'general',
  showTabs = true,
  tabs = ['general', 'organization', 'members', 'invitations'],
}: CompanySettingsProps) => {
  const { t } = useTranslation('auth');
  const { data: company, error, isLoading, mutate } = useMyCompany();
  const { data: departments = [] } = useCompanyDepartments(company?.id);
  const [tab, setTab] = useState<CompanySettingsTab>(initialTab);
  const tabItems = [
    {
      icon: <Building2Icon size={16} />,
      key: 'general',
      label: t('company.tab.general'),
    },
    { key: 'members', label: t('company.tab.members') },
    { key: 'organization', label: t('company.organization') },
    (company?.role === 'admin' || company?.role === 'owner') && {
      key: 'invitations',
      label: t('company.tab.invitations'),
    },
  ].filter(Boolean) as { icon?: ReactNode; key: CompanySettingsTab; label: string }[];

  if (error) return <ErrorState onRetry={() => void mutate()} />;

  return (
    <>
      <SettingHeader title={headerTitle ?? t('company.title')} />
      {isLoading ? (
        <Text>{t('company.loading')}</Text>
      ) : !company ? (
        <CreateCompany />
      ) : (
        <Flexbox gap={16}>
          {showTabs && (
            <Tabs
              activeKey={tab}
              items={tabs.flatMap((key) => tabItems.filter((item) => item.key === key))}
              onChange={(key) => setTab(key as typeof tab)}
            />
          )}
          {tab === 'general' && <General company={company} />}
          {tab === 'organization' && (
            <OrganizationChart departments={departments} workspaceId={company.id} />
          )}
          {tab === 'members' && (
            <Members
              canManage={company.role === 'admin' || company.role === 'owner'}
              departments={departments}
              isOwner={company.role === 'owner'}
              workspaceId={company.id}
            />
          )}
          {tab === 'invitations' && (company.role === 'admin' || company.role === 'owner') && (
            <Invitations departments={departments} workspaceId={company.id} />
          )}
        </Flexbox>
      )}
    </>
  );
};

export default CompanySettings;
