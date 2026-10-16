#import <Foundation/Foundation.h>
#import <Photos/Photos.h>
#import <objc/message.h>
#import <objc/runtime.h>

static void reply(NSDictionary *value) {
 NSData *data=[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys error:nil];
 [[NSFileHandle fileHandleWithStandardOutput] writeData:data];
}
static PHFetchOptions *options(BOOL trashed) {
 PHFetchOptions *opts=[PHFetchOptions new];opts.includeHiddenAssets=YES;opts.includeAllBurstAssets=YES;
 if(trashed)((void(*)(id,SEL,BOOL))objc_msgSend)(opts,NSSelectorFromString(@"setIncludeTrashedAssets:"),YES);
 return opts;
}
static NSSet *identifiers(PHFetchResult<PHAsset *> *assets) {
 NSMutableSet *ids=[NSMutableSet new];for(PHAsset *asset in assets)[ids addObject:asset.localIdentifier];return ids;
}
int main(){@autoreleasepool {
 @try {
  NSDictionary *input=[NSJSONSerialization JSONObjectWithData:[[NSFileHandle fileHandleWithStandardInput] readDataToEndOfFile] options:0 error:nil];
  NSArray *ids=input[@"ids"];
  if(![ids isKindOfClass:[NSArray class]]||ids.count==0||ids.count>100||[NSSet setWithArray:ids].count!=ids.count)@throw [NSException exceptionWithName:@"Input" reason:@"恢复请求无效" userInfo:nil];
  for(id identifier in ids)if(![identifier isKindOfClass:[NSString class]]||![identifier hasSuffix:@"/L0/001"]||![[NSUUID alloc] initWithUUIDString:[identifier componentsSeparatedByString:@"/"][0]])@throw [NSException exceptionWithName:@"Input" reason:@"恢复标识无效" userInfo:nil];
  if([PHPhotoLibrary authorizationStatusForAccessLevel:PHAccessLevelReadWrite]!=PHAuthorizationStatusAuthorized)@throw [NSException exceptionWithName:@"Authorization" reason:@"恢复需要现有的完整照片图库授权" userInfo:nil];
  SEL restore=NSSelectorFromString(@"undeleteAssets:"),include=NSSelectorFromString(@"setIncludeTrashedAssets:");
  Method method=class_getClassMethod([PHAssetChangeRequest class],restore);
  if(!method||method_getNumberOfArguments(method)!=3||![PHFetchOptions instancesRespondToSelector:include])@throw [NSException exceptionWithName:@"Capability" reason:@"此系统未提供可用的原位恢复接口" userInfo:nil];
  // Resolve only requested IDs. Already-active assets are an idempotent no-op.
  NSSet *active=identifiers([PHAsset fetchAssetsWithLocalIdentifiers:ids options:options(NO)]);
  NSMutableArray *pending=[NSMutableArray new];for(NSString *identifier in ids)if(![active containsObject:identifier])[pending addObject:identifier];
  NSSet *pendingSet=[NSSet setWithArray:pending];
  PHFetchResult<PHAsset *> *found=[PHAsset fetchAssetsWithLocalIdentifiers:pending options:options(YES)];
  NSMutableArray *assets=[NSMutableArray new];for(PHAsset *asset in found)[assets addObject:asset];
  // Some macOS releases omit trash from the identifier fetch. The ordinary
  // authorized collection fetch may include it; still retain only exact IDs.
  if(![identifiers(found) isEqualToSet:pendingSet]){
   [assets removeAllObjects];
   for(PHAsset *asset in [PHAsset fetchAssetsWithOptions:options(YES)])if([pendingSet containsObject:asset.localIdentifier])[assets addObject:asset];
  }
  NSMutableSet *resolved=[NSMutableSet new];for(PHAsset *asset in assets)[resolved addObject:asset.localIdentifier];
  if(![resolved isEqualToSet:pendingSet]||assets.count!=pending.count)@throw [NSException exceptionWithName:@"Identity" reason:[NSString stringWithFormat:@"系统照片接口仅能核对 %lu/%lu 项待恢复素材，未恢复",(unsigned long)assets.count,(unsigned long)pending.count] userInfo:nil];
  if([input[@"checkOnly"] boolValue]){reply(@{@"ok":@YES,@"pending":pending,@"alreadyActive":active.allObjects});return 0;}
  if(assets.count){
   __block BOOL done=NO,success=NO;__block NSError *failure=nil;
   [PHPhotoLibrary.sharedPhotoLibrary performChanges:^{((void(*)(id,SEL,id))objc_msgSend)([PHAssetChangeRequest class],restore,assets);} completionHandler:^(BOOL ok,NSError *error){success=ok;failure=error;@synchronized(assets){done=YES;}}];
   while(YES){@synchronized(assets){if(done)break;}[[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];}
   if(!success)@throw [NSException exceptionWithName:@"Restore" reason:failure.localizedDescription?:@"系统未确认恢复，请核验状态" userInfo:nil];
  }
  NSSet *after=identifiers([PHAsset fetchAssetsWithLocalIdentifiers:ids options:options(NO)]);
  if(![after isEqualToSet:[NSSet setWithArray:ids]])@throw [NSException exceptionWithName:@"Verify" reason:@"恢复后状态尚未确认，请核验；不会重复导入" userInfo:nil];
  reply(@{@"ok":@YES,@"restored":pending,@"alreadyActive":active.allObjects,@"verified":after.allObjects});
 }@catch(NSException *error){reply(@{@"ok":@NO,@"error":error.reason?:@"恢复失败"});}
 return 0;
}}
