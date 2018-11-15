#pragma once

#include "Core/PowerPC/MMU.h"

struct PlayerInfoRetriever
{
  bool UpdateInfo()
  {
    vehicle_info_ptr = PowerPC::HostRead_U32(0x803e2218);
    if (vehicle_info_ptr == 0)
    {
      return false;
    }
    else
    {
      track_relationship_info_ptr = PowerPC::HostRead_U32(vehicle_info_ptr - 0x20);
      return true;
    }
  }

  float PlayerVehicleX() { return PowerPC::HostRead_F32(vehicle_info_ptr + 0x7C); }
  float PlayerVehicleY() { return PowerPC::HostRead_F32(vehicle_info_ptr + 0x7C + 4); }
  float PlayerVehicleZ() { return PowerPC::HostRead_F32(vehicle_info_ptr + 0x7C + 8); }

  float PlayerSpeed() { return PowerPC::HostRead_F32(vehicle_info_ptr + 0x17C); }

  u32 CrashToRestoreFrameCount() { return PowerPC::HostRead_U32(vehicle_info_ptr + 0x194); }
  u16 DuringRestoreFrameCount() { return PowerPC::HostRead_U16(vehicle_info_ptr + 0x214); }

  bool GoingTheWrongWay() { return PowerPC::HostRead_U8(track_relationship_info_ptr + 0x66F); }

  u8 RestoreCountMod256() { return PowerPC::HostRead_U8(vehicle_info_ptr + 0x4C2); }

  u32 CurrentLapNumber() { return PowerPC::HostRead_U32(track_relationship_info_ptr + 0x678); }

  u8 PreviousLapTimeMins()
  {
    return PowerPC::HostRead_U8(track_relationship_info_ptr + 0x6CC + 0x8);
  }
  u8 PreviousLapTimeSecs()
  {
    return PowerPC::HostRead_U8(track_relationship_info_ptr + 0x6CC + 0x9);
  }
  u16 PreviousLapTimeMillis()
  {
    return PowerPC::HostRead_U16(track_relationship_info_ptr + 0x6CC + 0xA);
  }

  u32 TotalFrames() { return PowerPC::HostRead_U32(track_relationship_info_ptr + 0x744); }

private:
  u32 vehicle_info_ptr;
  u32 track_relationship_info_ptr;
};
