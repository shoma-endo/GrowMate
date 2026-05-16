'use client';

import React from 'react';
import { Tag } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Service } from '@/server/schemas/brief.schema';

interface ServiceSelectorProps {
  services: Service[];
  selectedServiceId: string | null;
  onServiceChange: (serviceId: string) => void;
  disabled?: boolean;
  className?: string;
}

export function ServiceSelector({
  services,
  selectedServiceId,
  onServiceChange,
  disabled = false,
  className = '',
}: ServiceSelectorProps) {
  if (!services || services.length <= 1) return null;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Tag className="h-4 w-4 text-muted-foreground" />
      <Select value={selectedServiceId || ''} onValueChange={onServiceChange} disabled={disabled}>
        <SelectTrigger className="w-[200px] h-9 text-sm">
          <SelectValue placeholder="サービスを選択" />
        </SelectTrigger>
        <SelectContent>
          {services.map(service => (
            <SelectItem key={service.id} value={service.id}>
              {service.name || '名称未設定'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
